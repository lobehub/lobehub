import type { AgentRunInitRequest } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';

/** Whether this user is inside the deferred-init rollout (see `AGENT_RUNTIME_DEFERRED_INIT`). */
export const isDeferredInitRolledOut = (setting: string | undefined, userId: string): boolean => {
  const value = setting?.trim();
  if (!value) return false;
  if (value === '*') return true;
  return value
    .split(',')
    .map((id) => id.trim())
    .includes(userId);
};

export interface DeferInitInput {
  /** Runs started without auto-start are stepped by their caller, not the queue. */
  autoStart: boolean;
  /** Set for every caller that is not the plain composer (bots, group members, sub-agents, ...). */
  hasOrchestration: boolean;
  queueRuntimeEnabled: boolean;
  request: AgentRunInitRequest;
  rolledOut: boolean;
  trigger?: string;
}

/**
 * Only a plain chat send may skip the init on the send path.
 *
 * Everything else needs what the init produces before it returns: an approval
 * resume dispatches against a prepared state, a fixed or required device has to
 * fail synchronously rather than after the caller was told the message was
 * sent, and an inline runtime has no step-0 worker to hand the init to.
 */
export const shouldDeferOperationInit = ({
  autoStart,
  hasOrchestration,
  queueRuntimeEnabled,
  request,
  rolledOut,
  trigger,
}: DeferInitInput): boolean =>
  rolledOut &&
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
  !request.requireDevice;
