import type { AgentAvailability } from '@lobechat/types';

/**
 * Which Agents an unaddressed Channel message may be routed to. An explicit
 * @mention never asks the policy: it is a direct assignment.
 *
 * The open-source build keeps it simple: any Agent that can still run takes
 * work, however much it already has queued. A deployment with a resource
 * scheduler (balance, load) overrides this module through its own
 * `@/business/server/...` mapping.
 */
export interface AgentDispatchPolicy {
  canTakeUnaddressed: (availability: Omit<AgentAvailability, 'dispatchable'>) => boolean;
}

export const agentDispatchPolicy: AgentDispatchPolicy = {
  // Offline: nothing reaches it. Off duty: its runs would fail on quota.
  // Sleeping and waking devices take work; the message wakes them.
  canTakeUnaddressed: ({ status }) => status !== 'offline' && status !== 'offDuty',
};
