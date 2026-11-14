import type { AgentRunInitRequest } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

/** A flag that cannot be read keeps the send on the synchronous init. */
export const isDeferredInitEnabled = async (userId: string): Promise<boolean> => {
  const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId).catch(() => undefined);
  return flags?.enableDeferredInit === true;
};

export interface DeferInitInput {
  /** Runs started without auto-start are stepped by their caller, not the queue. */
  autoStart: boolean;
  /**
   * Set for every caller that is not the plain composer (bots, group members, sub-agents, ...).
   * A client's LLM executor declaration is not one: the init never reads it.
   */
  hasOrchestration: boolean;
  queueRuntimeEnabled: boolean;
  request: AgentRunInitRequest;
  trigger?: string;
}

/**
 * Only a plain chat send may skip the init on the send path.
 *
 * Everything else needs what the init produces before it returns: an approval
 * resume dispatches against a prepared state, a fixed or required device has to
 * fail synchronously rather than after the caller was told the message was
 * sent, and an inline runtime has no step-0 worker to hand the init to.
 *
 * The flag is read last, so runs that could never defer pay no read for it.
 */
export const shouldDeferOperationInit = async (
  { autoStart, hasOrchestration, queueRuntimeEnabled, request, trigger }: DeferInitInput,
  isEnabled: () => Promise<boolean>,
): Promise<boolean> =>
  queueRuntimeEnabled &&
  autoStart &&
  !hasOrchestration &&
  trigger === RequestTrigger.Chat &&
  !request.resume &&
  !request.resumeApproval &&
  !request.resumeApprovals?.length &&
  !request.resumeFromHistory &&
  !request.resumeToolResult &&
  !request.isFixedDeviceTarget &&
  !request.requireDevice &&
  (await isEnabled());
