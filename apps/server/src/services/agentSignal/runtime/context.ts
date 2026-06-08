import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';

/** One persisted guard lane inside a runtime scope. */
export interface RuntimeGuardState {
  lastEventAt?: number;
  startedAt?: number;
}

/** Deferred work persisted for one runtime scope. */
export interface RuntimeWaypoint {
  trigger?: RuntimeNode;
}

/** Runtime node handled by the generalized runtime host. */
export type RuntimeNode = AgentSignalSource | BaseAction | BaseSignal;

/** Backend operations needed by the generalized runtime host. */
export interface RuntimeBackend {
  appendToWaypoint: (scopeKey: string, source: AgentSignalSource) => Promise<void>;
  getGuardState: (scopeKey: string, lane: string) => Promise<RuntimeGuardState | undefined>;
  loadWaypoint: (scopeKey: string) => Promise<RuntimeWaypoint>;
  touchGuardState: (scopeKey: string, lane: string, now: number) => Promise<RuntimeGuardState>;
}

/** Scope-bound state helpers exposed to runtime handlers and guards. */
export interface RuntimeScopedState {
  getGuardState: (lane: string) => Promise<RuntimeGuardState>;
  touchGuardState: (lane: string, now?: number) => Promise<RuntimeGuardState>;
}

/** Runtime handler context shared across one queue execution. */
export interface RuntimeProcessorContext {
  now: () => number;
  runtimeState: RuntimeScopedState;
  scopeKey: string;
}

/** Options for creating a scope-bound runtime processor context. */
export interface CreateRuntimeProcessorContextOptions {
  backend: Pick<RuntimeBackend, 'getGuardState' | 'touchGuardState'>;
  now?: () => number;
  scopeKey: string;
}

/** Creates one scope-bound runtime processor context. */
export const createRuntimeProcessorContext = (
  input: CreateRuntimeProcessorContextOptions,
): RuntimeProcessorContext => {
  const { backend, scopeKey } = input;
  const now = input.now ?? (() => Date.now());

  return {
    now,
    runtimeState: {
      async getGuardState(lane) {
        return (await backend.getGuardState(scopeKey, lane)) ?? {};
      },
      async touchGuardState(lane, currentTime = now()) {
        return backend.touchGuardState(scopeKey, lane, currentTime);
      },
    },
    scopeKey,
  };
};
