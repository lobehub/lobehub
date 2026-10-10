import type { SerializedAgentHook } from '@lobechat/types';

import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { hookDispatcher } from '@/server/services/agentRuntime/hooks';
import type {
  AfterCallAgentHookEvent,
  BeforeCallAgentHookEvent,
  CallAgentErrorHookEvent,
} from '@/server/services/agentRuntime/hooks/types';

interface CallAgentContext {
  /** Target child agent, preserving the existing CallAgent event semantics. */
  agentId: string;
  groupId?: string | null;
  instruction?: string;
  parentOperationId?: string;
  threadId?: string;
  topicId: string;
  userId: string;
}

interface CallAgentStartResult {
  error?: string;
  operationId?: string;
  started?: boolean;
  success?: boolean;
  threadId?: string;
}

// Keep correlation local until the shared hook event context is consolidated.
// A shared-group member has no isolation thread, so threadId is optional here.
type CallAgentNotification = (
  | BeforeCallAgentHookEvent
  | Omit<AfterCallAgentHookEvent, 'subOperationId' | 'threadId'>
  | CallAgentErrorHookEvent
) & {
  groupId?: string | null;
  parentOperationId: string;
  subOperationId?: string;
  threadId?: string;
  topicId: string;
  userId: string;
};

type NotificationFields = (
  | Pick<BeforeCallAgentHookEvent, 'instruction'>
  | Pick<AfterCallAgentHookEvent, 'success'>
  | Pick<CallAgentErrorHookEvent, 'error'>
) & { subOperationId?: string; threadId?: string };

/** Observe creation/startup; child completion belongs to that child's onComplete. */
export async function withCallAgentHooks<T extends CallAgentStartResult>(
  runtime: Pick<AgentRuntimeService, 'loadInterventionContinuationState'>,
  context: CallAgentContext,
  start: () => Promise<T>,
): Promise<T> {
  const { parentOperationId } = context;
  if (!parentOperationId) return start();

  let serializedHooks: SerializedAgentHook[] | undefined;
  try {
    // This public loader reads the authoritative state through the coordinator
    // in both local and queue modes. No parent process registration is needed.
    const state = await runtime.loadInterventionContinuationState(parentOperationId);
    serializedHooks = state?.host?.hooks;
  } catch (error) {
    console.error('[CallAgentHooks] Failed to load parent hooks', error);
  }

  const notify = async (
    type: 'beforeCallAgent' | 'afterCallAgent' | 'onCallAgentError',
    fields: NotificationFields,
  ) => {
    const event: CallAgentNotification = {
      agentId: context.agentId,
      groupId: context.groupId,
      operationId: parentOperationId,
      parentOperationId,
      threadId: context.threadId,
      topicId: context.topicId,
      userId: context.userId,
      ...fields,
    };
    try {
      await hookDispatcher.dispatch(parentOperationId, type, event, serializedHooks);
    } catch (error) {
      // These three hooks are notifications. Delivery must never replace a
      // startup result/error or cause a second child launch on queue retry.
      console.error(`[CallAgentHooks] Failed to dispatch ${type}`, error);
    }
  };

  await notify('beforeCallAgent', { instruction: (context.instruction ?? '').slice(0, 200) });

  let result: T;
  try {
    result = await start();
  } catch (error) {
    await notify('onCallAgentError', { error: String(error) });
    throw error;
  }

  const childContext = {
    subOperationId: result.operationId || undefined,
    threadId: result.threadId ?? context.threadId,
  };
  if (result.success ?? result.started ?? false) {
    await notify('afterCallAgent', {
      ...childContext,
      subOperationId: result.operationId,
      success: true,
    });
  } else {
    await notify('onCallAgentError', {
      ...childContext,
      error: result.error || 'Sub-agent execution failed',
    });
  }
  return result;
}
