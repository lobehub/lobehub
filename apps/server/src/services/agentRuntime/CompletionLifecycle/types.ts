import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import type { SerializedHook } from '../hooks';

export type SignalEvent = { [key: string]: unknown; type: string };

/**
 * Runs after a topic's own run settles — not a child run (sub-agent, group
 * member, `callAgent` target), not a park for approval, not a user stop. The
 * topic is free for the next turn at that point, which is when work that was
 * waiting on it (background sub-agent results) can be handed over. Scheduled
 * after the response; the handler owns its errors.
 */
export type TopicRunSettledHandler = (params: {
  operationId: string;
  topicId: string;
}) => Promise<void>;

/**
 * Normalized terminal-completion input for {@link CompletionLifecycle.completeOperation}.
 *
 * This is the single typed shape every NON-in-process terminal path passes in —
 * heterogeneous CLI exit (`heteroFinish`), remote-agent done signal
 * (`agentNotify`), and synchronous dispatch failure
 * (`finalizeHeteroDispatchError`). `completeOperation` expands it into the
 * runtime `state` shape `dispatchHooks` consumes via one builder, so there is
 * exactly ONE place that mirrors the runtime state — no per-caller hand-rolled
 * synthetic state to drift.
 *
 * The in-process runtime keeps calling `dispatchHooks` with its real, rich
 * `state` directly (full message array, interruption, …) — it needs no synthesis.
 */
export interface OperationCompletionInput {
  /** Owning agent id — trace snapshot key + the lifecycle event's `agentId`. */
  agentId?: string;
  /** Final assistant message row id — anchors the verify card / error bubble. */
  assistantMessageId?: string;
  cost?: { total?: number | null } | null;
  /** Final assistant deliverable text — the verify gate's input + bot rendering. */
  deliverable?: string;
  /** Terminal error payload (error path only). */
  error?: unknown;
  /**
   * The user goal (first user turn) — the verify gate judges against it. Typed
   * `unknown` because message content is polymorphic (string or multimodal part
   * array); `dispatchHooks` normalizes it to text the same way it does the
   * in-process path's user turn.
   */
  goal?: unknown;
  /** User-facing LLM-call count for the run (derived from `usage` when omitted). */
  llmCalls?: number | null;
  /** Executed model — the verify gate keys off `op.model`, so hetero backfills it. */
  model?: string | null;
  operationId: string;
  /** Group orchestration role; members must not trigger user-facing completion recalls. */
  orchestrationRole?: 'member' | 'supervisor';
  /** Executed provider — see {@link OperationCompletionInput.model}. */
  provider?: string | null;
  /** Serialized webhook hooks (queue mode); ignored in local in-memory mode. */
  serializedHooks?: SerializedHook[];
  /** When the run started, so the terminal row keeps its processing time. */
  startedAt?: Date | string;
  stepCount?: number | null;
  topicId?: string;
  /** Trace / usage aggregates (llm calls, tokens, tool calls). */
  usage?: unknown;
  userId?: string;
}

/** Options shared by {@link CompletionLifecycle.completeOperation} / `dispatchHooks`. */
export interface CompleteOperationOptions {
  /**
   * The durable row was already retired to `abandoned` / `lease_expired` by the
   * caller's own compare-and-set (`settleStaleRunning`). Persist the terminal
   * stats onto that status instead of `error`: `recordCompletion` refuses to
   * move a row out of one terminal status into another, so writing `error`
   * would be rejected and the hooks below would never fire.
   */
  settledAsAbandoned?: boolean;
  /**
   * Skip writing the terminal error onto the assistant message row. Set by callers
   * that already wrote a bespoke error bubble before delegating (e.g. the hetero
   * dispatch-failure path, which surfaces a device-specific `detail`).
   */
  skipErrorMessageWrite?: boolean;
}

/** What the extracted completion steps read off a `CompletionLifecycle` instance. */
export interface CompletionLifecycleDeps {
  agentOperationModel: AgentOperationModel;
  includeShareVisitor: boolean;
  messageModel: MessageModel;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}
