import { isParkedStatus } from '@lobechat/agent-runtime';
import type { MessageContentPart } from '@lobechat/types';
import { deserializeParts } from '@lobechat/utils';
import debug from 'debug';

import {
  AgentOperationModel,
  type RecordOperationStartParams,
} from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { VerifyRunModel } from '@/database/models/verifyRun';
import { type LobeChatDatabase } from '@/database/type';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import { buildFinalSnapshotKey } from '@/server/modules/AgentTracing';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import { extractSelfIterationCompletionPayload } from '@/server/services/agentSignal/services/selfIteration/completion';
import { instantiateVerifyPlanOnStart, runVerifyOnCompletion } from '@/server/services/verify';

import { hookDispatcher, type SerializedHook } from './hooks';

const log = debug('lobe-server:completion-lifecycle');

type SignalEvent = { [key: string]: unknown; type: string };

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
  /** Executed model — the verify gate keys off `op.model`, so hetero backfills it. */
  model?: string | null;
  operationId: string;
  /** Executed provider — see {@link OperationCompletionInput.model}. */
  provider?: string | null;
  /** Serialized webhook hooks (queue mode); ignored in local in-memory mode. */
  serializedHooks?: SerializedHook[];
  stepCount?: number | null;
  topicId?: string;
  /** Trace / usage aggregates (llm calls, tokens, tool calls). */
  usage?: unknown;
  userId?: string;
}

/** Options shared by {@link CompletionLifecycle.completeOperation} / `dispatchHooks`. */
export interface CompleteOperationOptions {
  /**
   * Skip writing the terminal error onto the assistant message row. Set by callers
   * that already wrote a bespoke error bubble before delegating (e.g. the hetero
   * dispatch-failure path, which surfaces a device-specific `detail`).
   */
  skipErrorMessageWrite?: boolean;
}

const toAgentSignalSnapshotEvents = (
  emission: Awaited<ReturnType<typeof emitAgentSignalSourceEvent>> | undefined,
): SignalEvent[] => {
  if (!emission || emission.deduped) return [];
  return toAgentSignalTraceEvents({
    actions: emission.orchestration.actions,
    results: emission.orchestration.results,
    signals: emission.orchestration.emittedSignals,
    source: emission.source,
  });
};

/**
 * Owns everything that happens once an operation reaches a terminal state:
 * building the lifecycle event payload, emitting completion AgentSignal source
 * events, dispatching `onComplete`/`onError` hooks, and writing the final
 * error back onto the assistant message row.
 *
 * All public methods are fire-and-forget: errors are logged but never thrown,
 * so the executor's terminal cleanup path (snapshot finalize, lock release)
 * always runs.
 */
export class CompletionLifecycle {
  private readonly messageModel: MessageModel;
  private readonly agentOperationModel: AgentOperationModel;
  private readonly workspaceId?: string;
  /**
   * In-flight verify-plan instantiations started in {@link recordStart}, keyed by
   * operationId. `dispatchHooks` awaits the matching one before running the
   * completion gate so a very short / no-op task run can't race past its own plan
   * (instantiation is fire-and-forget at start and may not have settled yet).
   */
  private readonly verifyPlanInstantiations = new Map<string, Promise<void>>();

  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string,
  ) {
    this.workspaceId = workspaceId;
    this.messageModel = new MessageModel(serverDB, userId, workspaceId);
    this.agentOperationModel = new AgentOperationModel(serverDB, userId, workspaceId);
  }

  /**
   * Persist the initial `agent_operations` row when an operation is created.
   * Fire-and-forget: a DB outage here must never block the runtime startup
   * path — `dispatchHooks` will still finalize the row if one was written.
   */
  async recordStart(params: RecordOperationStartParams): Promise<void> {
    try {
      await this.agentOperationModel.recordStart(params);
    } catch (error) {
      log('[%s] Failed to record operation start (non-fatal): %O', params.operationId, error);
    }

    // Auto-instantiate the task's verify plan at run start so the completion gate
    // fires. Only for a top-level task operation — repair / verifier sub-agents
    // (which carry a parentOperationId) get their plan from the repair path, not
    // here. Fire-and-forget; never blocks startup. We keep the promise (instead of
    // void-ing it) so `dispatchHooks` can await it before the completion gate runs
    // — a fast run can otherwise complete first and the gate would no-op on a plan
    // that lands moments later. (instantiateVerifyPlanOnStart never rejects.)
    if (params.taskId && !params.parentOperationId) {
      this.verifyPlanInstantiations.set(
        params.operationId,
        instantiateVerifyPlanOnStart(
          this.serverDB,
          this.userId,
          { operationId: params.operationId, taskId: params.taskId },
          this.workspaceId,
        ),
      );
    }
  }

  /**
   * Map a completion reason to the terminal `agent_operations.status` value.
   * `waiting_for_human` / `waiting_for_async_tool` keep their own status so
   * analytics can distinguish paused ops from terminal ones.
   */
  private statusForReason(
    reason: string,
  ): 'done' | 'error' | 'interrupted' | 'waiting_for_human' | 'waiting_for_async_tool' {
    switch (reason) {
      case 'error': {
        return 'error';
      }
      case 'interrupted': {
        return 'interrupted';
      }
      case 'waiting_for_human': {
        return 'waiting_for_human';
      }
      case 'waiting_for_async_tool': {
        return 'waiting_for_async_tool';
      }
      default: {
        return 'done';
      }
    }
  }

  /**
   * Persist terminal state to `agent_operations`. Fire-and-forget: a DB
   * outage must never block hook dispatch or the executor's terminal
   * cleanup path.
   */
  private async persistCompletion(operationId: string, state: any, reason: string): Promise<void> {
    const completionReason: any =
      reason === 'max_steps' ||
      reason === 'cost_limit' ||
      reason === 'waiting_for_human' ||
      reason === 'waiting_for_async_tool'
        ? reason
        : this.statusForReason(reason);

    const metadata = state?.metadata ?? {};
    const agentId = metadata?.agentId;
    const topicId = metadata?.topicId;
    const traceS3Key =
      agentId && topicId ? buildFinalSnapshotKey(agentId, topicId, operationId) : null;

    const processingTimeMs = state?.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : null;

    const status = this.statusForReason(reason);
    // Parked statuses are pauses, not true terminal states — leave completedAt
    // null so analytics doesn't read a paused op as completed. The next
    // dispatchHooks call (when the op resumes and truly ends) overwrites both.
    const completedAt = isParkedStatus(status) ? undefined : new Date();

    try {
      await this.agentOperationModel.recordCompletion(operationId, {
        completedAt,
        completionReason,
        cost: state?.cost ?? null,
        error: state?.error ?? null,
        interruption: state?.interruption ?? null,
        llmCalls: state?.usage?.llm?.apiCalls ?? null,
        // Backfill the executed model/provider when the terminal state carries
        // them. The in-process runtime sets neither on `state` (the op already
        // holds them from recordStart) so these stay undefined and recordCompletion
        // skips them — a no-op. A heterogeneous run, which only learns its real
        // model from the CLI stream, feeds them in via the synthetic state built in
        // heteroFinish; the verify gate keys off op.model/provider, so dropping this
        // backfill would leave op.model null and silently skip verify.
        model: state?.model,
        processingTimeMs,
        provider: state?.provider,
        status,
        stepCount: state?.stepCount ?? null,
        toolCalls: state?.usage?.tools?.totalCalls ?? null,
        totalCost: state?.cost?.total ?? null,
        totalInputTokens: state?.usage?.llm?.tokens?.input ?? null,
        totalOutputTokens: state?.usage?.llm?.tokens?.output ?? null,
        totalTokens: state?.usage?.llm?.tokens?.total ?? null,
        traceS3Key,
        usage: state?.usage ?? null,
      });
    } catch (error) {
      log('[%s] Failed to persist operation completion (non-fatal): %O', operationId, error);
    }
  }

  /**
   * Extract a human-readable error message from the agent state error object.
   * Handles both raw `ChatCompletionErrorPayload` (from runtime.step catch) and
   * formatted `ChatMessageError` (from executeStep catch).
   *
   * Public so callers can use the same formatting when surfacing errors
   * outside the hook dispatch path (e.g. trace snapshot finalize).
   */
  extractErrorMessage(error: any): string | undefined {
    if (!error) return undefined;

    // Path B: formatted ChatMessageError — { body, message, type }
    if (error.body) {
      const body = error.body;
      // OpenAI-style: body.error.message
      if (body.error?.message) return body.error.message;
      if (body.message) return body.message;
    }

    // Path A: raw ChatCompletionErrorPayload — { errorType, error: {...}, provider }
    if (error.error) {
      const inner = error.error;
      if (inner.error?.message) return inner.error.message;
      if (inner.message) return inner.message;
    }

    if (error.message && error.message !== 'error') return error.message;
    if (error.type || error.errorType) return String(error.type || error.errorType);

    return undefined;
  }

  /**
   * Emit completion AgentSignal source events and return compact snapshot
   * events for attachment to the trace step. Fire-and-forget.
   */
  async emitSignalEvents(operationId: string, state: any, reason: string): Promise<SignalEvent[]> {
    try {
      const { assistantMessageId, metadata } = this.buildLifecycleEvent(operationId, state, reason);
      const selfIteration =
        reason === 'error' ? undefined : extractSelfIterationCompletionPayload(state);
      if (reason !== 'error') {
        log(
          '[completion-lifecycle] emit agent.execution.completed op=%s userId=%s assistant=%s metaAssistant=%s selfIteration=%s',
          operationId,
          metadata?.userId || this.userId,
          assistantMessageId ?? 'undefined',
          metadata?.assistantMessageId ?? 'undefined',
          selfIteration
            ? `kind=${selfIteration.marker?.kind} mutations=${selfIteration.mutations?.length}`
            : 'ABSENT',
        );
      }
      const completionSignalEmission =
        reason === 'error'
          ? await emitAgentSignalSourceEvent(
              {
                payload: {
                  agentId: metadata?.agentId,
                  errorMessage: this.extractErrorMessage(state?.error),
                  operationId,
                  reason,
                  serializedContext: undefined,
                  topicId: metadata?.topicId,
                  turnCount: state?.stepCount || 0,
                },
                sourceId: `${operationId}:complete:${reason}`,
                sourceType: 'agent.execution.failed',
              },
              {
                agentId: metadata?.agentId,
                db: this.serverDB,
                userId: metadata?.userId || this.userId,
                workspaceId: this.workspaceId,
              },
              { ignoreError: true },
            )
          : await emitAgentSignalSourceEvent(
              {
                payload: {
                  agentId: metadata?.agentId,
                  // Anchor the deferred skill synthesis to the completed assistant
                  // turn: the completion-stage skill handler walks this id back
                  // to the user message to read the parked candidate and seeds
                  // the skill under the assistant group — instead of synthesizing
                  // from the user prompt alone at inbound time. Resolved from
                  // the final assistant message row when operation metadata omits
                  // it (the server execAgent path).
                  anchorMessageId: assistantMessageId,
                  assistantMessageId,
                  operationId,
                  // Carry the completion reason so completion-stage consumers can
                  // tell a finished turn from a non-terminal pause
                  // (waiting_for_async_tool / waiting_for_human), which reuse this
                  // same source.
                  reason,
                  // Self-iteration runs carry their finalState tool outcomes here
                  // (the one point finalState is in hand) so the completion policy
                  // can project receipts. Undefined for every other agent.
                  selfIteration,
                  serializedContext: undefined,
                  steps: state?.stepCount || 0,
                  topicId: metadata?.topicId,
                  turnCount: state?.stepCount || 0,
                },
                sourceId: `${operationId}:complete:${reason}`,
                sourceType: 'agent.execution.completed',
              },
              {
                agentId: metadata?.agentId,
                db: this.serverDB,
                userId: metadata?.userId || this.userId,
                workspaceId: this.workspaceId,
              },
              { ignoreError: true },
            );

      log(
        '[completion-lifecycle] emission done op=%s reason=%s deduped=%s',
        operationId,
        reason,
        (completionSignalEmission as { deduped?: boolean } | undefined)?.deduped ?? 'n/a',
      );

      return toAgentSignalSnapshotEvents(completionSignalEmission);
    } catch (error) {
      log('[%s] Completion signal emission error (non-fatal): %O', operationId, error);
      return [];
    }
  }

  /**
   * Insert a `role='verify'` message that renders the Agent Run delivery-checker
   * card (plan + results, read off `metadata.verifyOperationId`). Only created
   * when the run actually has a verify plan. Self-guarded — failures never affect
   * the run; the card is purely additive UI.
   */
  private async createVerifyMessage(
    operationId: string,
    assistantMessageId: string | undefined,
    userId: string,
  ): Promise<void> {
    try {
      const run = await new VerifyRunModel(this.serverDB, userId).findByOperation(operationId);
      if (!run?.plan?.length) return;

      const op = await new AgentOperationModel(this.serverDB, userId).findById(operationId);
      if (!op?.topicId) return;

      const messageModel = new MessageModel(this.serverDB, userId);
      await messageModel.create({
        agentId: op.agentId ?? undefined,
        content: '',
        groupId: op.chatGroupId ?? undefined,
        metadata: { verifyOperationId: operationId },
        parentId: assistantMessageId,
        role: 'verify',
        threadId: op.threadId ?? undefined,
        topicId: op.topicId,
      });
    } catch (error) {
      log('createVerifyMessage failed for op %s (non-fatal): %O', operationId, error);
    }
  }

  /**
   * Expand a normalized {@link OperationCompletionInput} into the runtime `state`
   * shape `dispatchHooks` consumes. The SINGLE place that mirrors the runtime
   * state for non-in-process paths — goal/deliverable become the user/assistant
   * turns the gate reads, model/provider backfill the op row, hooks ride on
   * `metadata._hooks`. Replaces the per-caller hand-rolled synthetic state that
   * previously drifted (e.g. a verify field added here was missed by heteroFinish).
   */
  private buildStateFromInput(input: OperationCompletionInput) {
    return {
      cost: input.cost ?? { total: null },
      error: input.error ?? undefined,
      messages: [
        { content: input.goal ?? '', role: 'user' },
        { content: input.deliverable ?? '', role: 'assistant' },
      ],
      metadata: {
        _hooks: input.serializedHooks,
        agentId: input.agentId,
        assistantMessageId: input.assistantMessageId,
        topicId: input.topicId,
        userId: input.userId ?? this.userId,
      },
      model: input.model ?? undefined,
      provider: input.provider ?? undefined,
      stepCount: input.stepCount ?? null,
      usage: input.usage ?? undefined,
    };
  }

  /**
   * The single terminal-completion entry for every path that does NOT have the
   * in-process runtime's rich `state` in hand: heterogeneous CLI exit
   * (`heteroFinish`), remote-agent done signal (`agentNotify`), and synchronous
   * dispatch failure (`finalizeHeteroDispatchError`). Builds the synthetic state
   * once and runs the SAME pipeline the in-process runtime uses — persist the
   * terminal op row, fire onComplete/onError hooks, and (on `done`) run the
   * delivery-checker verify gate. This is what makes those paths true lifecycle
   * peers instead of firing a stripped-down hooks-only funnel.
   */
  async completeOperation(
    input: OperationCompletionInput,
    reason: 'done' | 'error',
    options?: CompleteOperationOptions,
  ): Promise<void> {
    await this.dispatchHooks(input.operationId, this.buildStateFromInput(input), reason, options);
  }

  /**
   * Dispatch `onComplete` (and `onError` for `reason='error'`) hooks via
   * the global `hookDispatcher`. On the error path, also writes the error
   * back onto the assistant message row so the frontend can render it.
   * Fire-and-forget; always unregisters the operation from the dispatcher.
   */
  async dispatchHooks(
    operationId: string,
    state: any,
    reason: string,
    options?: CompleteOperationOptions,
  ): Promise<void> {
    // `waiting_for_async_tool` parks the SAME operation: it persists the parked
    // status (the async-tool resume CAS reads it) but must NOT fire `onComplete`
    // or unregister hooks — the op resumes under this same id and reaches its
    // real terminal state later, which is when consumers should be notified.
    // (`waiting_for_human` differs: its resume runs under a NEW operationId, so
    // firing + unregistering on the park is correct there.)
    const isAsyncToolPark = reason === 'waiting_for_async_tool';

    try {
      const { assistantMessageId, event, metadata } = this.buildLifecycleEvent(
        operationId,
        state,
        reason,
      );

      // Finalize the agent_operations row before user hooks fire so
      // downstream consumers see the row in its terminal shape.
      await this.persistCompletion(operationId, state, reason);

      if (isAsyncToolPark) return;

      // `lastAssistantContent` comes off the Redis-backed `state.messages`,
      // while the assistant message row is persisted through a separate
      // `messageModel.update` path. When the two diverge (state entry empty
      // but the DB row holds the full reply — LOBE-11632: bot completions
      // arrived with no content while the app showed the reply), consumers
      // like the IM bot callback silently drop the reply. Recover from the DB
      // row — the same source of truth the app UI renders — before dispatch.
      if (
        (reason === 'done' || reason === 'max_steps' || reason === 'cost_limit') &&
        !event.lastAssistantContent?.trim() &&
        !event.attachments?.length
      ) {
        const recovered = await this.recoverLastAssistantContent(
          operationId,
          assistantMessageId,
          metadata?.userId || this.userId,
        );
        if (recovered) event.lastAssistantContent = recovered;
      }

      await hookDispatcher.dispatch(operationId, 'onComplete', event, metadata._hooks);

      // Delivery checker: on a successful completion, run the confirmed verify
      // plan against the deliverable. Fire-and-forget and self-guarded — a run
      // without an opted-in plan is a no-op, and failures never affect the run.
      if (reason === 'done') {
        // The task's verify plan is instantiated fire-and-forget at run start; a
        // fast or no-op run can reach completion before it settles. Await the
        // in-flight instantiation (if any) so the gate sees the confirmed plan
        // instead of racing past it and leaving a planned run with no results/card.
        await this.verifyPlanInstantiations.get(operationId);

        const messages: any[] = Array.isArray(state?.messages) ? state.messages : [];
        const firstUserMessage = messages.find((m) => m?.role === 'user');
        const goal = firstUserMessage
          ? (extractTextFromMessageContent(firstUserMessage.content) ?? '')
          : '';
        // Surface the delivery-checker card first (a role='verify' message that
        // renders the run's plan + results). Awaited before verification so
        // auto-repair can persist its failure feedback onto this card (the
        // VerifyMessageProcessor then surfaces it into the repair run's context).
        // Self-guarded — failures never affect the run.
        await this.createVerifyMessage(
          operationId,
          metadata?.assistantMessageId,
          metadata?.userId || this.userId,
        );
        void runVerifyOnCompletion(
          this.serverDB,
          metadata?.userId || this.userId,
          {
            deliverable: event.lastAssistantContent ?? '',
            goal,
            operationId,
          },
          this.workspaceId,
        );
      }

      if (reason === 'error') {
        await hookDispatcher.dispatch(operationId, 'onError', event, metadata._hooks);

        const assistantMessageId = metadata?.assistantMessageId;
        if (assistantMessageId && state?.error && !options?.skipErrorMessageWrite) {
          // Preserve the semantic error type written by the runtime. Rebuilding
          // this as a generic AgentRuntimeError would lose UI routing data such
          // as quota context and force the client into the fallback card.
          const messageError = formatErrorForState(state.error);
          const errorMessage =
            this.extractErrorMessage(messageError) ||
            this.extractErrorMessage(state.error) ||
            String(state.error);
          try {
            await this.messageModel.update(assistantMessageId, {
              error: {
                ...messageError,
                body: messageError.body ?? { message: errorMessage },
                message: errorMessage,
              },
            });
          } catch (updateError) {
            log(
              '[%s] Failed to update assistant message with error (non-fatal): %O',
              operationId,
              updateError,
            );
          }
        }
      }
    } catch (error) {
      log('[%s] Hook dispatch error (non-fatal): %O', operationId, error);
    } finally {
      // Keep hooks registered across an async-tool park so the eventual resume
      // (same operationId) can still fire onComplete/onError.
      if (!isAsyncToolPark) {
        hookDispatcher.unregister(operationId);
        // The instantiation has settled (awaited above) or this op never opted in
        // — drop the entry so the map doesn't grow across the service's lifetime.
        // Kept across an async-tool park: the op resumes under the same id.
        this.verifyPlanInstantiations.delete(operationId);
      }
    }
  }

  /**
   * Load the final assistant message row from the DB and return its text
   * content, for completions whose Redis-side state carried no assistant
   * text (see the LOBE-11632 note in {@link dispatchHooks}). Non-fatal: any
   * failure just leaves the event as-built.
   */
  private async recoverLastAssistantContent(
    operationId: string,
    assistantMessageId: string | undefined,
    userId: string,
  ): Promise<string | undefined> {
    if (!assistantMessageId) return undefined;

    try {
      const messageModel =
        userId === this.userId
          ? this.messageModel
          : new MessageModel(this.serverDB, userId, this.workspaceId);
      const row = await messageModel.findById(assistantMessageId);
      const raw = typeof row?.content === 'string' ? row.content : undefined;
      if (!raw?.trim()) return undefined;

      // Multimodal rows store `content` as serialized MessageContentPart[]
      // (see callLlmFinalizer / serializePartsForStorage) — sending
      // that verbatim would deliver raw JSON to the bot channel. Gate on the
      // row's `metadata.isMultimodal` flag (the same signal the app UI uses
      // in DisplayContent) rather than sniffing the string, so a legitimate
      // plain-text reply that happens to be a JSON array is preserved as-is.
      // Extract only the text parts; an image-only row recovers nothing.
      const isMultimodal =
        (row?.metadata as { isMultimodal?: boolean } | null | undefined)?.isMultimodal === true;
      const parts = isMultimodal ? deserializeParts(raw) : null;
      const content = parts
        ? parts
            .filter((p): p is Extract<MessageContentPart, { type: 'text' }> => p.type === 'text')
            .map((p) => p.text)
            .join('')
        : raw;
      if (!content.trim()) return undefined;

      // console (not debug) so state/DB divergence stays visible in
      // production logs — the silent variant of this is what made
      // LOBE-11632 hard to diagnose.
      console.warn(
        `[CompletionLifecycle][${operationId}] completion event had no assistant text; recovered ${content.length} chars from message ${assistantMessageId}`,
      );
      return content;
    } catch (error) {
      log('[%s] recoverLastAssistantContent failed (non-fatal): %O', operationId, error);
      return undefined;
    }
  }

  private buildLifecycleEvent(operationId: string, state: any, reason: string) {
    const metadata = state?.metadata || {};
    const messages: any[] = Array.isArray(state?.messages) ? state.messages : [];

    // Pull text content off the **final** assistant turn. Content may be a
    // plain string or an OpenAI-style multimodal part array; for the array
    // case we concatenate the text parts so the reply body is preserved.
    //
    // We deliberately match on `role === 'assistant'` only — not on whether
    // the turn has any text — so an image-only or tool-output final turn
    // doesn't fall through to an earlier assistant message and ship stale
    // text alongside the current attachments.
    const lastAssistantMessage = messages
      .slice()
      .reverse()
      .find((m: { content?: unknown; id?: string; role: string }) => m.role === 'assistant');
    const lastAssistantContent = lastAssistantMessage
      ? extractTextFromMessageContent(lastAssistantMessage.content)
      : undefined;

    // Operation-level metadata only carries `assistantMessageId` on the client
    // runtime path; a server `execAgent` turn leaves it unset (`{}` in DB). Fall
    // back to the persisted id on the final assistant message row in state so the
    // completion event can anchor deferred skill synthesis to this turn (skill
    // synthesis deferred from inbound to turn completion so it uses the full
    // trajectory — tool sequence + final product — not just the user prompt).
    // A metadata value, when present, still wins.
    const assistantMessageId =
      metadata?.assistantMessageId ?? (lastAssistantMessage as { id?: string } | undefined)?.id;

    const attachments = extractOutboundAttachments(messages);

    const duration = state?.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : undefined;

    // On the error path, normalize the runtime error once so the lifecycle
    // event carries the stable taxonomy fields (errorType + attribution). Bot
    // reply renderers switch on these to surface a perceivable cause (network /
    // quota / provider outage …) instead of an opaque Operation ID. Mirrors the
    // same normalization dispatchHooks runs before writing the error onto the
    // assistant message row.
    const formattedError = state?.error ? formatErrorForState(state.error) : undefined;

    return {
      assistantMessageId,
      event: {
        agentId: metadata?.agentId || '',
        attachments: attachments.length > 0 ? attachments : undefined,
        cost: state?.cost?.total,
        duration,
        errorAttribution: formattedError?.attribution,
        errorDetail: state?.error,
        errorMessage: this.extractErrorMessage(state?.error) || String(state?.error || ''),
        errorType: formattedError?.type === undefined ? undefined : String(formattedError.type),
        finalState: state,
        lastAssistantContent,
        llmCalls: state?.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state?.status || reason,
        steps: state?.stepCount || 0,
        toolCalls: state?.usage?.tools?.totalCalls,
        topicId: metadata?.topicId,
        totalTokens: state?.usage?.llm?.tokens?.total,
        userId: metadata?.userId || this.userId,
      },
      metadata,
    };
  }
}

// --------------------------------------------------------------------------
// Outbound attachment extraction
// --------------------------------------------------------------------------

type OutboundAttachment = {
  data?: string;
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  type: 'image' | 'file' | 'video' | 'audio';
};

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/;

const inferAttachmentTypeFromMime = (mimeType: string | undefined): OutboundAttachment['type'] => {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
};

/**
 * Materialize a `url` field — either a `data:` URL (extract base64 inline) or
 * a remote URL (record fetchUrl). Returns undefined for unsupported shapes.
 */
const buildAttachmentFromUrl = (
  url: string | undefined,
  fallbackType: OutboundAttachment['type'] = 'image',
): OutboundAttachment | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  const dataMatch = url.match(DATA_URL_RE);
  if (dataMatch) {
    const mimeType = dataMatch[1];
    return {
      data: dataMatch[2],
      mimeType,
      type: inferAttachmentTypeFromMime(mimeType),
    };
  }
  // Bare http(s) URL — let the downstream messenger fetch it lazily.
  if (/^https?:\/\//.test(url)) {
    return { fetchUrl: url, type: fallbackType };
  }
  return undefined;
};

/**
 * Pull text out of a message's `content` field. Accepts both string and
 * OpenAI-style multimodal arrays `[{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`.
 */
const extractTextFromMessageContent = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content || undefined;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object' && (part as any).type === 'text') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  const joined = parts.join('');
  return joined || undefined;
};

/**
 * Extract image/file parts from a message's `content` array. Each entry is
 * mapped to the JSON-safe outbound attachment shape (data or fetchUrl).
 */
const extractAttachmentsFromContent = (content: unknown): OutboundAttachment[] => {
  if (!Array.isArray(content)) return [];
  const out: OutboundAttachment[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const type = (part as { type?: unknown }).type;
    if (type === 'image_url') {
      const url = (part as { image_url?: { url?: string } }).image_url?.url;
      const att = buildAttachmentFromUrl(url, 'image');
      if (att) out.push(att);
    } else if (type === 'image') {
      // Anthropic-style: { type: 'image', source: { type: 'base64', media_type, data } }
      const source = (part as { source?: { data?: string; media_type?: string; type?: string } })
        .source;
      if (source?.type === 'base64' && source.data) {
        const mimeType = source.media_type;
        out.push({
          data: source.data,
          mimeType,
          type: inferAttachmentTypeFromMime(mimeType),
        });
      } else if (source?.type === 'url') {
        const url = (source as { url?: string }).url;
        const att = buildAttachmentFromUrl(url, 'image');
        if (att) out.push(att);
      }
    } else if (type === 'file' || type === 'file_url') {
      const file = (part as { file?: { url?: string; name?: string; mime_type?: string } }).file;
      const att = buildAttachmentFromUrl(file?.url, 'file');
      if (att) {
        att.name = file?.name ?? att.name;
        att.mimeType = file?.mime_type ?? att.mimeType;
        out.push(att);
      }
    }
  }
  return out;
};

/**
 * Walk recent messages and collect outbound image/file attachments to send
 * alongside the reply. Scans the last assistant message *and* any tool
 * messages that came after the previous assistant turn — tool-generated
 * images (e.g. a drawing tool that returns an image_url result) need to be
 * delivered with the next reply.
 *
 * Deduplicates by data/fetchUrl identity.
 */
const extractOutboundAttachments = (messages: any[]): OutboundAttachment[] => {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Walk from the end backwards: collect attachments until we hit the
  // previous assistant turn that already has text — that boundary marks
  // "the current reply window".
  const collected: OutboundAttachment[] = [];
  let crossedFinalAssistant = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') continue;
    const role = (msg as { role?: string }).role;
    const content = (msg as { content?: unknown }).content;

    if (role === 'assistant') {
      if (!crossedFinalAssistant) {
        // The final assistant turn: harvest its multimodal parts.
        collected.push(...extractAttachmentsFromContent(content));
        crossedFinalAssistant = true;
        continue;
      }
      // A previous assistant turn — stop walking, we don't want to dredge up
      // attachments from prior conversation rounds.
      break;
    }

    if (role === 'tool') {
      // Tool results between the previous assistant turn and the final one.
      collected.push(...extractAttachmentsFromContent(content));
    }
  }

  // Reverse so message-order (older first) is preserved, then dedupe.
  collected.reverse();
  const seen = new Set<string>();
  const result: OutboundAttachment[] = [];
  for (const att of collected) {
    const key = att.fetchUrl ?? att.data ?? '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(att);
  }
  return result;
};
