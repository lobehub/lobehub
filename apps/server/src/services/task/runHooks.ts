import type { TaskRunTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

export interface TaskRunHookParams {
  db: LobeChatDatabase;
  taskId: string;
  taskIdentifier: string;
  /**
   * What opened this run. The lifecycle reads it to tell an ad-hoc run apart
   * from an automation tick (only ticks spend the attempt budget), so it is part
   * of the contract this hook carries — not the caller's local bookkeeping.
   */
  trigger?: TaskRunTrigger;
  userId: string;
  workspaceId?: string;
}

/**
 * The hooks that attach a Task's lifecycle to one of its runs.
 *
 * A run reaches the Task only through `onTopicComplete`, and the hook that
 * delivers it is registered at dispatch — so every entry point that dispatches
 * into a Task's topic has to register it. There are two: the runner (`runTask`,
 * which owns scheduled, heartbeat and ad-hoc runs) and the composer, when a user
 * answers a finished run in that run's own conversation. Leaving the composer
 * out is not a cosmetic gap: the answered run would then reach no Task-side row
 * at all — the run keeps the finished state of the run it replied to, no
 * handoff/result is written for the answer, and the Task never transitions.
 */
export const createTaskRunHooks = (params: TaskRunHookParams): AgentHook[] => {
  const { db, taskId, taskIdentifier, trigger, userId, workspaceId } = params;

  return [
    {
      handler: async (event) => {
        await new TaskLifecycleService(db, userId, workspaceId).onTopicComplete({
          errorCode: event.errorType,
          errorMessage: event.errorMessage,
          lastAssistantContent: event.lastAssistantContent,
          operationId: event.operationId,
          reason: event.reason || 'done',
          runTrigger: trigger,
          taskId,
          taskIdentifier,
          topicId: event.topicId,
        });
      },
      id: 'task-on-complete',
      type: 'onComplete' as const,
      webhook: {
        // `runTrigger` rides in the static body so the production webhook
        // callback (which reconstructs onTopicComplete params server-side)
        // knows whether this was a manual run or an automation tick.
        body: { runTrigger: trigger, taskId, taskIdentifier, userId },
        delivery: 'qstash' as const,
        fallback: 'none' as const,
        url: '/api/workflows/task/on-topic-complete',
      },
    },
  ];
};
