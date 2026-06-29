import {
  type AgentEvent,
  type AgentInstruction,
  type InstructionExecutor,
} from '@lobechat/agent-runtime';

import { TopicModel } from '@/database/models/topic';

import { type RuntimeExecutorContext } from '../context';
import { log } from '../executorHelpers';

export const finish =
  (ctx: RuntimeExecutorContext): InstructionExecutor =>
  async (instruction, state) => {
    const { reason, reasonDetail } = instruction as Extract<AgentInstruction, { type: 'finish' }>;
    const { operationId, stepIndex, streamManager } = ctx;

    log('[%s:%d] Finishing execution: (%s)', operationId, stepIndex, reason);

    // Clear runningOperation from topic metadata so reconnect doesn't trigger after completion
    if (ctx.topicId && ctx.userId) {
      try {
        const topicModel = new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId);
        await topicModel.updateMetadata(ctx.topicId, { runningOperation: null });
      } catch (e) {
        log('[%s] Failed to clear runningOperation metadata: %O', operationId, e);
      }
    }

    // Publish execution complete event. `finalState.messages` + tool-set
    // fields are stripped centrally inside `publishStreamEvent` so this
    // call site stays unaware.
    await streamManager.publishStreamEvent(operationId, {
      data: {
        finalState: { ...state, status: 'done' },
        phase: 'execution_complete',
        reason,
        reasonDetail,
      },
      stepIndex,
      type: 'step_complete',
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.status = 'done';

    const events: AgentEvent[] = [
      {
        finalState: newState,
        reason,
        reasonDetail,
        type: 'done',
      },
    ];

    return { events, newState };
  };
