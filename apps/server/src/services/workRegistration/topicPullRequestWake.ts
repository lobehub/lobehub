import { ScmChangeRequestModel } from '@/database/models/scm';
import type { TopicModel } from '@/database/models/topic';
import type { ScmChangeRequestItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { isTopicPullRequestListed } from './topicPullRequestLinks';

/** What a topic's link did to the conversation the PR's Auto-fix wakes. */
export type TopicPullRequestWakeOutcome =
  /** This topic is now the conversation its CI failures and reviews wake. */
  | 'bound'
  /** It already was. */
  | 'kept'
  /** Another conversation holds it: an acceptance, a Work, or an earlier link. */
  | 'taken'
  /** No GitHub App installation tracks the PR, so nothing would wake anyone. */
  | 'untracked'
  /** The PR's row is not the linking person's own in the scope they link from. */
  | 'foreign'
  /** The PR left the topic's list while the bind was in flight; undone. */
  | 'withdrawn';

interface PullRequestIdentity {
  number: number;
  repoFullName: string;
}

interface LinkScope {
  userId: string;
  workspaceId?: string | null;
}

/**
 * The fence for a topic link. The link is the client's word: a branch match
 * is what the person's device reported, a by-hand link is a pasted URL. So
 * it may only aim Auto-fix at a row whose owner the server established on
 * its own:
 *
 * - same tenant: the row lives in the workspace the person links from, or in
 *   their personal scope when they link from there;
 * - same person: `row.userId` is the linking user. On an author-routed row
 *   that is the account whose linked GitHub identity opened the PR, as named
 *   by a signature-verified webhook. On an installation-routed row it is the
 *   person who connected the installation the PR arrived through.
 *
 * The wake runs as `row.userId` and builds its prompt from the PR's job logs
 * and reviews. Without the second half, a teammate who pastes another
 * member's PR URL would aim that member's wakes (their budget, their CI
 * output) at a conversation of their own, and take the fill-only slot from
 * the author's own Work as well. This is the fence `attachPullRequestWork`
 * applies to a Work the server parsed from the run itself; a client-named
 * link gets no more than that.
 */
const ownsRow = (row: ScmChangeRequestItem, scope: LinkScope) =>
  row.userId === scope.userId &&
  (scope.workspaceId ? row.workspaceId === scope.workspaceId : !row.workspaceId);

/** The URL was typed or reported by a client, so its casing may differ from GitHub's. */
const findRow = (db: LobeChatDatabase, pr: PullRequestIdentity) =>
  ScmChangeRequestModel.findByIdentityIgnoringCase(db, 'github', pr.repoFullName, pr.number);

/** The generation of the claim `topicId`'s own link holds on the row, if it holds one. */
const linkClaimOf = (row: ScmChangeRequestItem, topicId: string): string | null => {
  const held = row.metadata?.topicLink;
  return row.topicId === topicId && held?.topicId === topicId ? (held.claimId ?? null) : null;
};

const listsPullRequest = async (
  topicModel: TopicModel,
  topicId: string,
  pr: PullRequestIdentity,
): Promise<boolean> => {
  const topic = await topicModel.findById(topicId);
  return isTopicPullRequestListed(topic?.metadata?.pullRequests, `${pr.repoFullName}#${pr.number}`);
};

/**
 * Make the topic that just kept a PR on its list (branch match or Link a PR)
 * the conversation the PR's Auto-fix wakes, as a Work registration would.
 * Fill-only: an acceptance's or a Work's conversation, or another topic's
 * link, keeps the slot. A row that does not exist yet (no installation
 * tracks the repository) is left alone; provider events never read topic
 * links, so the next run-end branch match or a fresh Link a PR binds it once
 * the App tracks the PR.
 *
 * Call it only once the topic lists the PR. Binds and removals of the same
 * PR can interleave, so both sides follow one protocol. A bind first stamps
 * a new claim generation (also when this topic's link already holds the
 * slot) and only then reads the topic's list. A release first reads the
 * generation, then the list, and clears only that generation. Whichever
 * side reads the list last sees the other's write, and a release decided
 * before a relink finds the relink's newer generation and does nothing.
 */
export const bindTopicPullRequestWake = async (params: {
  db: LobeChatDatabase;
  pr: PullRequestIdentity;
  scope: LinkScope;
  topicId: string;
  topicModel: TopicModel;
}): Promise<TopicPullRequestWakeOutcome> => {
  const row = await findRow(params.db, params.pr);
  if (!row) return 'untracked';
  if (!ownsRow(row, params.scope)) return 'foreign';
  if (row.topicId && row.topicId !== params.topicId) return 'taken';
  // An acceptance or a Work already wakes this topic. No marker to keep, and
  // no removal of the link will clear it.
  if (row.topicId === params.topicId && !linkClaimOf(row, params.topicId)) return 'kept';

  const claimId = await ScmChangeRequestModel.claimTopicFromLink(
    params.db,
    row.id,
    params.scope,
    params.topicId,
  );
  if (!claimId) {
    // The row changed between the read and the claim: a concurrent ingest
    // filled or re-routed it. Whatever it chose came from a source the
    // events trust, so it stays.
    const fresh = await ScmChangeRequestModel.findById(params.db, row.id);
    if (fresh?.topicId === params.topicId) return 'kept';
    return fresh && !ownsRow(fresh, params.scope) ? 'foreign' : 'taken';
  }

  // A removal that committed before this claim may have found nothing to
  // release yet, so read the list again now that the claim is visible.
  if (!(await listsPullRequest(params.topicModel, params.topicId, params.pr))) {
    await ScmChangeRequestModel.releaseTopicFromLink(params.db, row.id, params.topicId, claimId);
    return 'withdrawn';
  }
  return row.topicId === params.topicId ? 'kept' : 'bound';
};

/**
 * The PR was removed from the topic: release the conversation that this
 * topic's link made Auto-fix wake. A conversation an acceptance or a Work
 * supplied stays: those sources are re-resolved on every provider event, so
 * clearing them here would only last until the next push. Turning Auto-fix
 * off is how to stop those wakes. Call it after the removal is saved; see
 * {@link bindTopicPullRequestWake} for how it is fenced against a relink.
 * `true` when something was released.
 */
export const releaseTopicPullRequestWake = async (params: {
  db: LobeChatDatabase;
  pr: PullRequestIdentity;
  topicId: string;
  topicModel: TopicModel;
}): Promise<boolean> => {
  const row = await findRow(params.db, params.pr);
  const claimId = row && linkClaimOf(row, params.topicId);
  if (!row || !claimId) return false;
  // Relinked since the removal: that link's bind owns the slot now.
  if (await listsPullRequest(params.topicModel, params.topicId, params.pr)) return false;
  return ScmChangeRequestModel.releaseTopicFromLink(params.db, row.id, params.topicId, claimId);
};
