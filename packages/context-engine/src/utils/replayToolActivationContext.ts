import type { ToolActivationContext, ToolActivationPlan } from '@lobechat/types';

/** Instructions already live in immutable replay events; adapters only project declarations. */
export const replayToolActivationContext = (
  messages: Array<{ role: string; toolActivationPlan?: ToolActivationPlan }>,
): ToolActivationContext | undefined => {
  const plan = messages.find(
    (message) => message.role === 'tool' && message.toolActivationPlan,
  )?.toolActivationPlan;
  return (
    plan && {
      additions: plan.results.map((result) => ({
        afterToolCallId: result.callId,
        instructions: '',
        names: result.toolNames,
        definitionRevisions: result.definitionRevisions,
      })),
    }
  );
};
