import debug from 'debug';

import type { VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';

export type { ResolvedTaskAcceptance } from './taskAcceptanceResolution';
export { resolveTaskAcceptance } from './taskAcceptanceResolution';

const log = debug('lobe-server:verify-task-acceptance');

/**
 * Bind a task-bound verification round to the Acceptance that owns the Task's
 * completion contract.
 *
 * `instantiateVerifyPlanOnStart` attaches the plan it creates itself, but a builder
 * that authors its own plan through the CLI (`verify.generateDraftPlan` →
 * `verify.confirmPlan`) writes a round with no acceptance. That round still verifies
 * and still passes, and then the Goal's Acceptance review — which can only reach the
 * delivery through its Acceptance — errors with "no Acceptance". That failure class
 * has no recovery branch, so a delivery that met every criterion ends up parked on a
 * human decision gate.
 *
 * Idempotent and best-effort: a round that already belongs to an acceptance is left
 * alone, and a refusal (already accepted / closed aggregate) must never break verify.
 *
 * Returns the row the round now lives in, which the caller must keep using: attaching
 * onto an acceptance whose newest round is still a draft FOLDS this run into that
 * draft and deletes the source row, moving its operation id across. A caller that
 * kept the id it came in with would go on claiming and reading a row that no longer
 * exists.
 */
export const attachTaskRunToAcceptance = async <
  T extends Pick<VerifyRunItem, 'acceptanceId' | 'id'>,
>(
  db: LobeChatDatabase,
  userId: string,
  params: { acceptanceId: string; run: T },
  workspaceId?: string,
): Promise<T | VerifyRunItem> => {
  if (params.run.acceptanceId) return params.run;

  try {
    const attached = await new AcceptanceService(db, userId, workspaceId).attachPolicyRun(
      params.run.id,
      params.acceptanceId,
    );
    log('attached run %s to task acceptance %s', params.run.id, params.acceptanceId);
    return attached;
  } catch (error) {
    log(
      'could not attach run %s to acceptance %s (non-fatal): %O',
      params.run.id,
      params.acceptanceId,
      error,
    );
    return params.run;
  }
};
