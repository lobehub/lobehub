import type { AgentHookType, AnyHookEvent, ToolCallHookEvent } from '../types';

export interface ToolCallMockResult {
  content: string;
  isMocked: true;
}

/**
 * Lifecycle dispatch port. Decouples executors from the server-side
 * `HookDispatcher`: an executor calls `lifecycle.dispatch(...)` at its key
 * moments and the host wires it to whatever observes them (server webhook
 * dispatcher, client no-op, eval harness).
 *
 * This is the coarse-grained surface mirroring the existing 16 hook types.
 * Per-stage lifecycle nodes (prepare → request → stream → persist → finalize)
 * are layered on top of this when each executor migrates, not redefined here.
 *
 * `dispatchBeforeToolCall` is the one interception point (returns a mock result
 * to skip real execution); everything else is fire-and-forget observation.
 */
export interface LifecycleSink {
  dispatch: (type: AgentHookType, event: AnyHookEvent) => Promise<void>;
  dispatchBeforeToolCall: (
    event: Omit<ToolCallHookEvent, 'mock' | 'operationId'>,
  ) => Promise<ToolCallMockResult | null>;
}
