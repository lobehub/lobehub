import type { AgentHookType, AnyHookEvent, ToolCallHookEvent } from '../types';

export interface ToolCallMockResult {
  content: string;
  isMocked: true;
}

export interface LifecycleDispatchParams {
  /** The lifecycle hook event payload. */
  event: AnyHookEvent;
  /**
   * Per-operation webhook configs (the server keeps them on
   * `state.metadata._hooks` for production/queue mode). Opaque to the package
   * and forwarded verbatim to the adapter.
   */
  serializedHooks?: unknown;
  /** Which of the coarse-grained hook types this dispatch fires. */
  type: AgentHookType;
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
  dispatch: (params: LifecycleDispatchParams) => Promise<void>;
  dispatchBeforeToolCall: (
    event: Omit<ToolCallHookEvent, 'mock' | 'operationId'>,
  ) => Promise<ToolCallMockResult | null>;
}
