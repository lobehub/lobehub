import type { AgentState } from '@lobechat/agent-runtime';
import type { ConversationContext, UIChatMessage } from '@lobechat/types';

import type { AgentRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import type { OperationStatus } from '@/store/chat/slices/operation/types';

/**
 * Whether a run is the user-facing top-level run or a nested sub-agent run.
 * Top-level-only side effects (title generation, input-queue drain, desktop
 * notification) are gated OFF for `sub_agent`.
 */
export type RunScope = 'sub_agent' | 'top_level';

/** Terminal disposition, normalized across the three runtimes. */
export type RunTerminalStatus = 'cancelled' | 'completed' | 'failed';

/** The two non-terminal parked states a run can enter and later resume from. */
export type RunParkedReason = 'waiting_for_async_tool' | 'waiting_for_human';

/**
 * Identity + scope of a single logical run.
 *
 * A run can span MULTIPLE operations: when it parks (`waiting_for_human` /
 * `waiting_for_async_tool`) and the user approves / rejects / submits / skips, a
 * NEW operation resumes the same logical run. Terminal side effects fire once per
 * logical run — keyed by `runId` — not once per operation.
 */
export interface RunLifecycleContext {
  context: ConversationContext;
  runId: string;
  runScope: RunScope;
  runtimeType: AgentRuntimeType;
}

interface RunLifecycleEventBase extends RunLifecycleContext {
  operationId: string;
}

export interface UserMessagePersistedEvent extends RunLifecycleEventBase {
  /** The just-created assistant placeholder — excluded from the title context. */
  assistantMessageId?: string;
  isCreateNewTopic: boolean;
  /**
   * Title-context messages, supplied by the client path (`data.messages`) where
   * the new-topic rows aren't in the store under the real topicId yet. Gateway /
   * hetero omit it — the hook reads the persisted conversation from the store.
   */
  messages?: UIChatMessage[];
  topicId?: string;
}

export type RunStartedEvent = RunLifecycleEventBase;

export interface RunParkedEvent extends RunLifecycleEventBase {
  reason: RunParkedReason;
}

export interface RunResumedEvent extends RunLifecycleEventBase {
  /** The operationId of the new operation that resumes the parked run. */
  resumedOperationId: string;
}

export interface TerminalPersistedEvent extends RunLifecycleEventBase {
  assistantMessageId?: string;
}

export interface RunCompleteEvent extends RunLifecycleEventBase {
  assistantMessageId?: string;
  /**
   * Final assistant content (raw markdown) for transports whose reply lives in
   * executor memory rather than the store (hetero's `accContent`). When present,
   * {@link AgentRunLifecycle.afterRunComplete} feeds it to the notification body
   * instead of deriving from `messagesMap`. The client adapter omits it (it reads
   * the store); hetero supplies it.
   */
  notification?: { content?: string };
  operationStatus?: OperationStatus;
  /**
   * Raw runtime terminal/parked status (client `AgentState['status']`), used to
   * reproduce the exact per-status completion branch. Optional — gateway/hetero
   * adapters that don't expose it rely on `status` instead.
   */
  runtimeStatus?: AgentState['status'];
  /**
   * Normalized cross-runtime terminal disposition. Optional: the client adapter
   * drives completion off {@link runtimeStatus}; gateway/hetero adapters supply
   * this instead.
   */
  status?: RunTerminalStatus;
}

/**
 * Result of `completeRun`. `requeued` is true when the input-queue drain
 * scheduled a follow-up `sendMessage` — the caller then SKIPS `afterRunComplete`
 * (no desktop notification for a run that immediately continues), matching the
 * current early-return behavior.
 */
export interface RunCompleteResult {
  requeued: boolean;
}

export interface RunErrorEvent extends RunLifecycleEventBase {
  error?: unknown;
}

/**
 * Store/UI-layer, single-direction (broadcast) run lifecycle.
 *
 * Assembled ONCE per run at the dispatch seam (`buildRunLifecycle`, next to
 * `selectRuntimeType`) and injected into whichever runtime adapter executes the
 * run. Runtimes only CALL these hooks at their own boundaries; they no longer
 * decide where title / signal / queue-drain / notification / metadata effects run.
 *
 * NOT to be confused with the runtime-internal, bidirectional, BLOCKING hooks in
 * `@lobechat/agent-runtime` (`beforeStep` / `beforeToolCall` / `onComplete` …)
 * that intercept execution and can mock/halt it. This layer is one-way and only
 * reacts to a run's lifecycle — the two must not be conflated.
 */
export interface AgentRunLifecycle {
  /** UI side effects after completion: desktop notification + dock badge. */
  afterRunComplete: (event: RunCompleteEvent) => Promise<void>;
  /** post-persist: topic title auto-generation (top-level, gated on the title rule). */
  afterUserMessagePersisted: (event: UserMessagePersistedEvent) => Promise<void>;
  beforeRunComplete: (event: RunCompleteEvent) => Promise<void>;
  /**
   * Core completion, in a fixed order across all three runtimes:
   * afterCompletion callbacks → completeOperation → markUnread → normalized
   * `client.runtime.complete` signal → queue drain (success terminal only).
   * Returns whether a queued follow-up was scheduled (see {@link RunCompleteResult}).
   */
  completeRun: (event: RunCompleteEvent) => Promise<RunCompleteResult>;
  onRunError: (event: RunErrorEvent) => Promise<void>;
  /** Entered a parked state. Terminal effects MUST NOT fire here. */
  onRunParked: (event: RunParkedEvent) => Promise<void>;
  /** A new operation resumes the same logical run after a park. */
  onRunResumed: (event: RunResumedEvent) => Promise<void>;
  onRunStarted: (event: RunStartedEvent) => Promise<void>;
  onTerminalPersisted: (event: TerminalPersistedEvent) => Promise<void>;
}
