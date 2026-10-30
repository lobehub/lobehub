import type { AgentState } from '@lobechat/agent-runtime';

import { renewAgentRunSlot } from '@/business/server/agent-run/runConcurrency';

/** Renewal cadence, well inside the lease lifetime so one missed tick does not drop it. */
export const RUN_SLOT_RENEW_MS = 60_000;

/**
 * Keeps the run tree's concurrency slot alive while this step executes. A
 * child run renews its parent's slot: one tree holds one slot, so a parent
 * parked on its children keeps it for as long as they work. Renewing never
 * recreates a lapsed lease, so runs that took no slot stay slot-free.
 *
 * @returns stops the periodic renewal
 */
export const startRunSlotLease = (userId: string, state: AgentState): (() => void) => {
  const holderId = state.origin?.lineage?.parentOperationId ?? state.operationId;

  const renew = () => {
    renewAgentRunSlot(userId, holderId).catch(() => undefined);
  };
  renew();
  const timer = setInterval(renew, RUN_SLOT_RENEW_MS);
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
};
