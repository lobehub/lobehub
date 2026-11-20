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

/**
 * Make the topic that just kept a PR on its list (branch match or Link a PR)
 * the conversation the PR's Auto-fix wakes, as a Work registration would.
 * Fill-only: an acceptance's or a Work's conversation, or another topic's
 * link, keeps the slot. A row that does not exist yet (no installation
 * tracks the repository) is left alone; provider events never read topic
 * links, so the next run-end branch match or a fresh Link a PR binds it once
 * the App tracks the PR.
 *
 * Call it only once the topic lists the PR. A removal racing the bind is
 * caught after the claim, and the claim is undone.
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
  if (row.topicId === params.topicId) return 'kept';
  if (row.topicId) return 'taken';

  const claimed = await ScmChangeRequestModel.claimTopicFromLink(
    params.db,
    row.id,
    params.scope,
    params.topicId,
  );
  // A concurrent ingest filled or re-routed the row first. Whatever it chose
  // came from a source the events trust, so it stays.
  if (!claimed) return 'taken';

  // A removal that committed between the topic write and this claim found
  // nothing to release yet, so check the list again now that the claim is
  // visible.
  const topic = await params.topicModel.findById(params.topicId);
  const identifier = `${params.pr.repoFullName}#${params.pr.number}`;
  if (!isTopicPullRequestListed(topic?.metadata?.pullRequests, identifier)) {
    await ScmChangeRequestModel.releaseTopicFromLink(params.db, row.id, params.topicId);
    return 'withdrawn';
  }
  return 'bound';
};

/**
 * The PR was removed from the topic: release the conversation that this
 * topic's link made Auto-fix wake. A conversation an acceptance or a Work
 * supplied stays: those sources are re-resolved on every provider event, so
 * clearing them here would only last until the next push. Turning Auto-fix
 * off is how to stop those wakes. `true` when something was released.
 */
export const releaseTopicPullRequestWake = async (params: {
  db: LobeChatDatabase;
  pr: PullRequestIdentity;
  topicId: string;
}): Promise<boolean> => {
  const row = await findRow(params.db, params.pr);
  if (row?.topicId !== params.topicId) return false;
  return ScmChangeRequestModel.releaseTopicFromLink(params.db, row.id, params.topicId);
};
