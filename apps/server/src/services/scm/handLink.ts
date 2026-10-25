import debug from 'debug';

import { ScmChangeRequestModel } from '@/database/models/scm';
import type { AcceptanceItem, ScmChangeRequestItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  addPullRequestLink,
  removePullRequestLink,
  updateAcceptancePullRequests,
} from '@/server/services/verify/acceptancePullRequests';

import type { ParsedChangeRequestUrl } from './changeRequestUrl';
import { ScmControlService } from './ScmControlService';

const log = debug('lobe-server:scm:hand-link');

type LinkableAcceptance = Pick<AcceptanceItem, 'id' | 'userId' | 'workspaceId'>;

/**
 * A hand link may only claim a provider row that lives in the acceptance's
 * own tenant: the same workspace, or the same person's personal scope. The
 * row is keyed globally, so a pasted URL must not reach into someone else's.
 */
const sameTenant = (row: ScmChangeRequestItem, acceptance: LinkableAcceptance) =>
  acceptance.workspaceId
    ? row.workspaceId === acceptance.workspaceId
    : !row.workspaceId && row.userId === acceptance.userId;

/** The URL was pasted by a person, so its owner/repo casing may differ from GitHub's. */
const findRow = (db: LobeChatDatabase, pr: ParsedChangeRequestUrl) =>
  ScmChangeRequestModel.findByIdentityIgnoringCase(db, 'github', pr.repoFullName, pr.number);

/**
 * Give the provider row of a hand-linked PR its acceptance, so a merge
 * accepts the delivery the same way a body link would. A row that already
 * names an acceptance keeps it. Returns the bound row's id.
 *
 * Run it inside the transaction that writes the hand link (see
 * {@link linkHandPullRequest}), so it is serialized with an unlink.
 *
 * A PR the provider has not reported yet has no row; its first event finds
 * the hand link itself (see `resolveChangeRequestLinks`).
 */
export const bindHandLinkedChangeRequest = async (
  db: LobeChatDatabase,
  acceptance: LinkableAcceptance,
  pr: ParsedChangeRequestUrl,
): Promise<string | null> => {
  const row = await findRow(db, pr);
  if (!row || !sameTenant(row, acceptance)) return null;

  // Conditional on the row still being free: another acceptance may be
  // claiming the same PR right now, under a lock on its own row, not ours.
  // The subject's conversation is deliberately not linked: a hand link says
  // which delivery the PR closes, not whose conversation its CI failures and
  // reviews should wake, and an unlink must leave nothing behind.
  const bound = await ScmChangeRequestModel.claimAcceptance(db, row.id, acceptance.id);
  return bound?.id ?? null;
};

/** Undo {@link bindHandLinkedChangeRequest} when the hand link is removed. */
export const unbindHandLinkedChangeRequest = async (
  db: LobeChatDatabase,
  acceptance: LinkableAcceptance,
  pr: ParsedChangeRequestUrl,
): Promise<void> => {
  const row = await findRow(db, pr);
  if (row?.acceptanceId === acceptance.id) {
    await ScmChangeRequestModel.detachAcceptance(db, row.id, acceptance.id);
  }
};

/**
 * Catch a freshly bound row up on what it missed: a PR already merged
 * accepts now, an open one gets its tracking comment. Runs after the link
 * commits — it may call the provider — so it re-reads the row and does
 * nothing if an unlink got in between.
 */
export const catchUpHandLinkedChangeRequest = async (
  db: LobeChatDatabase,
  acceptanceId: string,
  rowId: string,
): Promise<void> => {
  const row = await ScmChangeRequestModel.findById(db, rowId);
  if (row?.acceptanceId !== acceptanceId) return;

  // Must not fail the link the user asked for; the next provider event retries it.
  try {
    const outcome = await new ScmControlService(db).onAcceptanceLinked(row);
    log('%s#%d bound to %s -> %o', row.repoFullName, row.number, acceptanceId, outcome);
  } catch (error) {
    log('catch-up for %s#%d failed: %O', row.repoFullName, row.number, error);
  }
};

/** Record a hand link and bind its provider row in one serialized write, then catch up. */
export const linkHandPullRequest = async (
  db: LobeChatDatabase,
  acceptance: LinkableAcceptance,
  pr: ParsedChangeRequestUrl,
  title?: string,
): Promise<void> => {
  let rowId: string | null = null;
  await updateAcceptancePullRequests(
    db,
    acceptance.id,
    (links) => addPullRequestLink(links, pr, title),
    async (tx) => {
      rowId = await bindHandLinkedChangeRequest(tx, acceptance, pr);
    },
  );
  if (rowId) await catchUpHandLinkedChangeRequest(db, acceptance.id, rowId);
};

/** Remove a hand link and its provider binding together. `false` when it was not linked. */
export const unlinkHandPullRequest = async (
  db: LobeChatDatabase,
  acceptance: LinkableAcceptance,
  pr: ParsedChangeRequestUrl,
): Promise<boolean> => {
  const links = await updateAcceptancePullRequests(
    db,
    acceptance.id,
    (current) => removePullRequestLink(current, pr),
    (tx) => unbindHandLinkedChangeRequest(tx, acceptance, pr),
  );
  return links !== null;
};
