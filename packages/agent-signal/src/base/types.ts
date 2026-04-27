/** Shared scope metadata for one AgentSignal chain. */
export interface AgentSignalScope {
  agentId?: string;
  botScopeKey?: string;
  taskId?: string;
  topicId?: string;
  userId: string;
}

/** Causal chain metadata for source, signal, and action nodes. */
export interface AgentSignalChainRef {
  chainId?: string;
  parentActionId?: string;
  parentNodeId?: string;
  parentSignalId?: string;
  rootSourceId: string;
}

/**
 * Backward-compatible chain alias used by the current AgentSignal facade.
 */
export interface ChainRef extends AgentSignalChainRef {}

/**
 * Reference to a source node.
 */
export interface SourceRef {
  sourceId: string;
  sourceType: string;
}

/**
 * Reference to a signal node.
 */
export interface SignalRef {
  signalId: string;
  signalType: string;
}

/** Base source node for the AgentSignal semantic core. */
export interface AgentSignalSource {
  chain: AgentSignalChainRef;
  payload: Record<string, unknown>;
  scope?: AgentSignalScope;
  scopeKey: string;
  sourceId: string;
  sourceType: string;
  timestamp: number;
}

/**
 * Backward-compatible source alias used by the current AgentSignal facade.
 */
export interface BaseSource extends AgentSignalSource {}

/** Base signal node for the AgentSignal semantic core. */
export interface AgentSignalSignal {
  chain: AgentSignalChainRef;
  payload: Record<string, unknown>;
  signalId: string;
  signalType: string;
  source: SourceRef;
  timestamp: number;
}

/**
 * Backward-compatible signal alias used by older code paths.
 */
export interface BaseSignal extends AgentSignalSignal {}

/** Base action node for the AgentSignal semantic core. */
export interface AgentSignalActionNode {
  actionId: string;
  actionType: string;
  chain: AgentSignalChainRef;
  output?: Record<string, unknown>;
  payload: Record<string, unknown>;
  signal: SignalRef;
  source: SourceRef;
  timestamp: number;
}

/**
 * Backward-compatible action alias used by older code paths.
 */
export interface BaseAction extends AgentSignalActionNode {}

/** One execution attempt for a leaf action. */
export interface SignalAttempt {
  completedAt?: number;
  current: number;
  max?: number;
  startedAt: number;
  status: 'cancelled' | 'failed' | 'running' | 'skipped' | 'succeeded';
}

/** Agent-backed execution attempt metadata. */
export interface AgenticAttempt extends SignalAttempt {
  agentId?: string;
  model?: string;
  runId?: string;
}

/** Structured executor failure. */
export interface ExecutorError {
  cause?: unknown;
  code: string;
  message: string;
  retriable?: boolean;
  retryAfterMs?: number;
}

/**
 * Executor outcome with stable status and attempt metadata.
 */
export interface ExecutorResultBase {
  actionId: string;
  attempt: SignalAttempt | AgenticAttempt;
  detail?: string;
  emittedSignalIds?: string[];
}

/**
 * Executor outcome for successful and skipped runs.
 */
export interface AppliedOrSkippedExecutorResult extends ExecutorResultBase {
  error?: never;
  status: 'applied' | 'skipped';
}

/**
 * Executor outcome for failed runs.
 */
export interface FailedExecutorResult extends ExecutorResultBase {
  error: ExecutorError;
  status: 'failed';
}

/**
 * Structured executor outcome for the current AgentSignal facade.
 */
export type ExecutorResult = AppliedOrSkippedExecutorResult | FailedExecutorResult;

/** Runtime result for a processor that asks the host to wait. */
export interface RuntimeWaitProcessorResult {
  pending?: Record<string, unknown>;
  status: 'wait';
}

/**
 * Runtime result for dispatching additional work.
 */
export interface RuntimeDispatchProcessorResult {
  actions?: BaseAction[];
  signals?: BaseSignal[];
  status: 'dispatch';
}

/**
 * Runtime result for scheduling a future hop.
 */
export interface RuntimeScheduleProcessorResult {
  nextHop: Record<string, unknown>;
  status: 'schedule';
}

/**
 * Runtime result for concluding a chain.
 */
export interface RuntimeConcludeProcessorResult {
  concluded?: Record<string, unknown>;
  status: 'conclude';
}

/**
 * Base runtime processor result used by guards and later runtime hosts.
 */
export type RuntimeProcessorResult =
  | RuntimeConcludeProcessorResult
  | RuntimeDispatchProcessorResult
  | RuntimeScheduleProcessorResult
  | RuntimeWaitProcessorResult;

/**
 * Trigger metadata attached to a generated source event.
 */
export interface SignalTriggerMetadata {
  scopeKey: string;
  token: string;
  windowEventCount: number;
}

/**
 * Deduped source-event result.
 */
export interface DedupedSourceEventResult {
  deduped: true;
  reason: 'duplicate' | 'scope_locked';
}

/**
 * Generated source-event result.
 */
export interface GeneratedSourceEventResult {
  deduped: false;
  source: AgentSignalSource;
  trigger: SignalTriggerMetadata;
}

/**
 * Source-event emission result.
 */
export type EmitSourceEventResult = DedupedSourceEventResult | GeneratedSourceEventResult;
