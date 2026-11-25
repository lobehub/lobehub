import { RequestTrigger, type SpendOrigin, toAgentShareVisitorIds } from '@lobechat/types';

import { type ToolExecutionContext } from '../types';

/**
 * Spend attribution for billed work a tool triggers (image / video
 * generation), matching what the run's LLM calls carry:
 *
 * - A share-visitor run executes under the shared agent's CREATOR, so its
 *   spend is indistinguishable from the creator's own usage unless the share
 *   is stamped on the charge. Projected ids only — never spread
 *   `context.agentShareVisitor`, which also carries the run's tool/memory
 *   permissions.
 * - Any other agent run carries its root agent, so the spend counts toward the
 *   same agent as the run's LLM calls.
 */
export const buildToolSpendOrigin = (context: ToolExecutionContext): SpendOrigin | undefined => {
  if (context.agentShareVisitor) {
    return {
      agentShare: toAgentShareVisitorIds(context.agentShareVisitor),
      trigger: RequestTrigger.AgentShare,
    };
  }

  return context.billingAgentId ? { billingAgentId: context.billingAgentId } : undefined;
};
