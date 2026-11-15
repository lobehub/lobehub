import type { AgentInstruction, InstructionExecutor } from '@lobechat/agent-runtime';
import { isGraphAgentNodeWork } from '@lobechat/agent-runtime';
import debug from 'debug';

import { redisService } from '@/server/services/redis';

const log = debug('lobe-server:steer-queue');

type RuntimeExecutors = Partial<Record<AgentInstruction['type'], InstructionExecutor>>;

/**
 * Reopen a graph sub-agent's steer queue when its graph moves on to another
 * node's work.
 *
 * A sub-agent seals its queue at its terminal node's answer, its last read
 * before it ends (`injectQueuedFollowUp`). A graph whose terminal node routes
 * back to another node (a review sending the work back) does not end there:
 * it starts that node's LLM call in the same step. Clearing the seal right
 * before that call lets the parent steer it again; the call ends in a tool
 * result or an answer, where the queue is read once more.
 *
 * Best-effort: a seal left in place only makes the parent wait for the result.
 */
export const withGraphSteerReopen = (
  executors: RuntimeExecutors,
  operationId: string,
): RuntimeExecutors => {
  const callLlm = executors.call_llm;
  if (!callLlm) return executors;

  return {
    ...executors,
    call_llm: async (instruction, state, context) => {
      if (state.origin?.lineage?.isSubAgent && isGraphAgentNodeWork(state)) {
        await redisService.steerQueue
          .unseal(operationId)
          .catch((error) =>
            log('[%s] Reopening the steer queue for a graph node failed: %O', operationId, error),
          );
      }

      return callLlm(instruction, state, context);
    },
  };
};
