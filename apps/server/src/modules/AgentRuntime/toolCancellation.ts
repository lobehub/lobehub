import type { AgentInstruction, InstructionExecutor } from '@lobechat/agent-runtime';

import type { RuntimeExecutorContext } from './context';

/** A failed authoritative read is an execution error, never permission to launch. */
export const isToolOperationCancelled = async (
  ctx: RuntimeExecutorContext,
  signal = ctx.abortSignal,
): Promise<boolean> => {
  if (signal?.aborted) return true;
  try {
    const interrupted = await ctx.checkToolCancellation?.();
    return interrupted === true || signal?.aborted === true;
  } catch {
    throw new Error(`Unable to verify operation cancellation for ${ctx.operationId}`);
  }
};

/** Recheck after asynchronous permission classification, before creating approval rows. */
export const guardToolApproval =
  (
    ctx: RuntimeExecutorContext,
    approve: InstructionExecutor,
    abort: InstructionExecutor,
  ): InstructionExecutor =>
  async (instruction, state) => {
    if (!(await isToolOperationCancelled(ctx))) return approve(instruction, state);
    const request = instruction as Extract<AgentInstruction, { type: 'request_human_approve' }>;
    const parentMessageId =
      request.parentMessageId ??
      state.messages.findLast((message) => message.role === 'assistant')?.id;
    if (!parentMessageId)
      throw new Error('Missing assistant parent while cancelling tool approval');
    return abort(
      {
        type: 'resolve_aborted_tools',
        payload: {
          parentMessageId,
          toolsCalling: request.pendingToolsCalling,
        },
      },
      state,
    );
  };
