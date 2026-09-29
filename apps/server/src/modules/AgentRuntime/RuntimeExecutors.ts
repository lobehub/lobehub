import type { AgentInstruction, InstructionExecutor } from '@lobechat/agent-runtime';
import { createAgentRuntimeExecutors, createToolPreparation } from '@lobechat/agent-runtime';

import { buildHost } from './buildHost';
import type { RuntimeExecutorContext } from './context';
import { guardToolApproval, isToolOperationCancelled } from './toolCancellation';

export { type RuntimeExecutorContext } from './context';

export const createRuntimeExecutors = (
  ctx: RuntimeExecutorContext,
): Partial<Record<AgentInstruction['type'], InstructionExecutor>> => {
  const executors = createAgentRuntimeExecutors(buildHost(ctx));
  executors.request_human_approve = guardToolApproval(
    ctx,
    executors.request_human_approve!,
    executors.resolve_aborted_tools!,
  );
  return executors;
};

export const createRuntimeToolPreparation = (ctx: RuntimeExecutorContext) => {
  const prepare = createToolPreparation(buildHost(ctx));
  const guarded: ReturnType<typeof createToolPreparation> = async (context, state) => {
    if (context.phase !== 'llm_result' && context.phase !== 'human_approved_tool') return;
    if (await isToolOperationCancelled(ctx)) {
      state.status = 'interrupted';
      return;
    }
    await prepare(context, state);
    // Also covers cached preparation and awaits in durable approval restoration.
    if (await isToolOperationCancelled(ctx)) state.status = 'interrupted';
  };
  return guarded;
};
