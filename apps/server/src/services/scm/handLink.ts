import debug from 'debug';

import { ScmChangeRequestModel } from '@/database/models/scm';
import type { AcceptanceItem, ScmChangeRequestItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { ParsedChangeRequestUrl } from './changeRequestUrl';
import { ScmControlService } from './ScmControlService';

const log = debug('lobe-server:scm:hand-link');

type LinkableAcceptance = Pick<
  AcceptanceItem,
  'id' | 'subjectId' | 'subjectType' | 'userId' | 'workspaceId'
>;

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
 * names an acceptance keeps it. A PR merged before the link was made is
 * accepted right away. Returns the row when it was bound.
 *
 * A PR the provider has not reported yet has no row; its first event finds
 * the hand link itself (see `resolveChangeRequestLinks`).
 */
export const bindHandLinkedChangeRequest = async (
  db: LobeChatDatabase,
  acceptance: LinkableAcceptance,
  pr: ParsedChangeRequestUrl,
): Promise<ScmChangeRequestItem | null> => {
  const row = await findRow(db, pr);
  if (!row || !sameTenant(row, acceptance)) return null;
  if (row.acceptanceId && row.acceptanceId !== acceptance.id) return null;

  const bound = await ScmChangeRequestModel.attachLinks(db, row.id, {
    acceptanceId: acceptance.id,
    taskId: acceptance.subjectType === 'task' ? acceptance.subjectId : undefined,
    topicId: acceptance.subjectType === 'topic' ? acceptance.subjectId : undefined,
  });
  if (bound?.acceptanceId !== acceptance.id) return null;

  // Catching up on the provider side (accepting, commenting) must not fail
  // the link the user asked for; the next provider event retries it.
  try {
    const outcome = await new ScmControlService(db).onAcceptanceLinked(bound);
    log('%s#%d bound to %s -> %o', bound.repoFullName, bound.number, acceptance.id, outcome);
  } catch (error) {
    log('catch-up for %s#%d failed: %O', bound.repoFullName, bound.number, error);
  }
  return bound;
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
