import type {
  LifecycleDispatchParams,
  LifecycleSink,
  ToolCallMockResult,
} from '@lobechat/agent-runtime';

import { type HookDispatcher } from '@/server/services/agentRuntime/hooks/HookDispatcher';

/**
 * Server {@link LifecycleSink} adapter — forwards runtime lifecycle dispatches
 * to the operation's `HookDispatcher`, binding `operationId`. `serializedHooks`
 * (the per-operation webhook configs the executor reads off `state.metadata`)
 * is passed through for production/queue mode.
 */
export class ServerLifecycleSink implements LifecycleSink {
  constructor(
    private readonly hookDispatcher: HookDispatcher,
    private readonly operationId: string,
  ) {}

  async dispatch({ type, event, serializedHooks }: LifecycleDispatchParams): Promise<void> {
    await this.hookDispatcher.dispatch(
      this.operationId,
      type as any,
      event as any,
      serializedHooks as any,
    );
  }

  async dispatchBeforeToolCall(
    event: Parameters<LifecycleSink['dispatchBeforeToolCall']>[0],
  ): Promise<ToolCallMockResult | null> {
    return (await this.hookDispatcher.dispatchBeforeToolCall(
      this.operationId,
      event as any,
    )) as ToolCallMockResult | null;
  }
}
