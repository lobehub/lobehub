import { RequestTrigger } from '@lobechat/types';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/** A flag that cannot be read keeps the send on the synchronous dispatch. */
export const isDeferredHeteroDispatchEnabled = async (userId: string): Promise<boolean> => {
  const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId).catch(() => undefined);
  return flags?.enableDeferredHeteroDispatch === true;
};

export interface DeferHeteroDispatchInput {
  /**
   * Set for every caller that is not the plain composer: a group member, an
   * isolation-thread child, a Task run, a reserved (Channel) operation. Those
   * callers act on the dispatch result itself, so it has to be final.
   */
  hasOrchestration: boolean;
  trigger?: string;
}

/**
 * Only a plain chat send may return before its device dispatch completes.
 *
 * The composer already handles a dispatch that fails after the response (the
 * timed-out ack and the woken managed device both settle that way): the error
 * is written onto the assistant message and the run's stream closes. Every
 * other caller reads `success` / `terminalReported` from the result, so it
 * keeps the synchronous dispatch.
 *
 * The flag is read last, so runs that could never defer pay no read for it.
 * Never rejects.
 */
export const shouldDeferHeteroDispatch = async (
  { hasOrchestration, trigger }: DeferHeteroDispatchInput,
  isEnabled: () => Promise<boolean>,
): Promise<boolean> =>
  !hasOrchestration && trigger === RequestTrigger.Chat && (await isEnabled().catch(() => false));
