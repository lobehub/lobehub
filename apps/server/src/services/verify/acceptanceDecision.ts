import type { AcceptanceModel } from '@/database/models/acceptance';
import type { AcceptanceItem } from '@/database/schemas/verify';

/**
 * A user decision needs a SETTLED round to judge (`delivered`, or `errored`
 * — the verifier could not run, the user may still take or refuse the
 * delivery). Deciding mid-flight would stamp a terminal state (and possibly
 * complete a task) before any report/verdict exists, and `recomputeStatus`
 * treats `accepted` as sticky, so a premature accept could never be
 * corrected by the pipeline.
 */
export const requireDecidableAcceptance = async (
  acceptanceModel: AcceptanceModel,
  acceptanceId: string,
): Promise<AcceptanceItem> => {
  const acceptance = await acceptanceModel.findById(acceptanceId);
  if (!acceptance) throw new Error(`Acceptance "${acceptanceId}" not found`);
  if (acceptance.status === 'accepted') {
    throw new Error('This delivery has already been accepted');
  }
  if (acceptance.status === 'closed') {
    throw new Error('This acceptance is closed — reopen it before making a decision');
  }
  if (acceptance.status === 'rejected') {
    throw new Error('This delivery was rejected — the next verification round re-opens it');
  }
  if (acceptance.status !== 'delivered' && acceptance.status !== 'errored') {
    throw new Error(
      `Verification is still in progress (${acceptance.status}) — the decision comes once the round settles`,
    );
  }
  return acceptance;
};
