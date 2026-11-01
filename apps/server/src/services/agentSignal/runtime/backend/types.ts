import type { AgentSignalSource, ExecutorError } from '@lobechat/agent-signal';

/** Completed waypoint state for one runtime scope. */
export interface RuntimeCompletedWaypointState {
  completedAt?: number;
  sourceId: string;
  status: 'completed';
}

/** Failed waypoint state for one runtime scope. */
export interface RuntimeFailedWaypointState {
  error: ExecutorError;
  failedAt?: number;
  sourceId: string;
  status: 'failed';
}

/** Terminal waypoint state for one runtime scope. */
export type RuntimeTerminalState = RuntimeCompletedWaypointState | RuntimeFailedWaypointState;

/** Pending source claim for one runtime scope. */
export interface RuntimePendingClaim {
  scopeKey: string;
  source: AgentSignalSource;
  status: 'pending';
}

/** Scheduled next-hop metadata for one runtime scope. */
export interface RuntimeNextHop {
  payload?: Record<string, unknown>;
  runAt: number;
  scopeKey: string;
}

/** Persisted waypoint snapshot for one runtime scope. */
export interface RuntimeWaypoint {
  events: AgentSignalSource[];
  nextHop?: RuntimeNextHop;
  pending?: RuntimePendingClaim;
  scopeKey: string;
  terminal?: RuntimeTerminalState;
}

/** Input for marking one source as completed. */
export interface RuntimeCompletionInput {
  completedAt?: number;
  scopeKey: string;
  sourceId: string;
}

/** Input for marking one source as failed. */
export interface RuntimeFailureInput {
  error: ExecutorError;
  failedAt?: number;
  scopeKey: string;
  sourceId: string;
}

/** Runtime backend contract for durable waypoint processing. */
export interface AgentSignalRuntimeBackend {
  appendToWaypoint: (scopeKey: string, source: AgentSignalSource) => Promise<void>;
  claimPending: (scopeKey: string) => Promise<RuntimePendingClaim | null>;
  complete: (input: RuntimeCompletionInput) => Promise<void>;
  fail: (input: RuntimeFailureInput) => Promise<void>;
  loadWaypoint: (scopeKey: string) => Promise<RuntimeWaypoint>;
  scheduleNextHop: (input: RuntimeNextHop) => Promise<void>;
}

/** Storage adapter used by durable AgentSignal runtime backends. */
export interface AgentSignalRuntimeBackendStore {
  append: (scopeKey: string, source: AgentSignalSource) => Promise<void>;
  claim: (scopeKey: string) => Promise<RuntimePendingClaim | null>;
  complete: (input: RuntimeCompletionInput) => Promise<void>;
  fail: (input: RuntimeFailureInput) => Promise<void>;
  load: (scopeKey: string) => Promise<RuntimeWaypoint>;
  schedule?: (input: RuntimeNextHop) => Promise<void>;
}

/** Scheduling adapter used by durable AgentSignal runtime backends. */
export interface AgentSignalRuntimeScheduler {
  schedule: (input: RuntimeNextHop) => Promise<void>;
}
