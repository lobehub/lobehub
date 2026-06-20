import { isParkedStatus } from '@lobechat/agent-runtime';
import debug from 'debug';

import {
  AgentOperationModel,
  type RecordOperationStartParams,
} from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { type LobeChatDatabase } from '@/database/type';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import { buildFinalSnapshotKey } from '@/server/modules/AgentTracing';
import { emitAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { toAgentSignalTraceEvents } from '@/server/services/agentSignal/observability/traceEvents';
import { extractSelfIterationCompletionPayload } from '@/server/services/agentSignal/services/selfIteration/completion';
import { runVerifyOnCompletion } from '@/server/services/verify';

import { hookDispatcher } from './hooks';

const log = debug('lobe-server:completion-lifecycle');

type SignalEvent = { [key: string]: unknown; type: string };

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
        processingTimeMs,
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
      const { metadata } = this.buildLifecycleEvent(operationId, state, reason);
      const selfIteration =
        reason === 'error' ? undefined : extractSelfIterationCompletionPayload(state);
      if (reason !== 'error') {
        log(
          '[completion-lifecycle] emit agent.execution.completed op=%s userId=%s selfIteration=%s',
          operationId,
          metadata?.userId || this.userId,
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
                  operationId,
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
      const operationModel = new AgentOperationModel(this.serverDB, userId);
      const state = await operationModel.getVerifyState(operationId);
      if (!state?.verifyPlan?.length) return;

      const op = await operationModel.findById(operationId);
      if (!op?.topicId) return;

      const messageModel = new MessageModel(this.serverDB, userId);
      await messageModel.create({
        agentId: op.agentId ?? undefined,
        content: '',
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
   * Dispatch `onComplete` (and `onError` for `reason='error'`) hooks via
   * the global `hookDispatcher`. On the error path, also writes the error
   * back onto the assistant message row so the frontend can render it.
   * Fire-and-forget; always unregisters the operation from the dispatcher.
   */
  async dispatchHooks(operationId: string, state: any, reason: string): Promise<void> {
    // `waiting_for_async_tool` parks the SAME operation: it persists the parked
    // status (the async-tool resume CAS reads it) but must NOT fire `onComplete`
    // or unregister hooks — the op resumes under this same id and reaches its
    // real terminal state later, which is when consumers should be notified.
    // (`waiting_for_human` differs: its resume runs under a NEW operationId, so
    // firing + unregistering on the park is correct there.)
    const isAsyncToolPark = reason === 'waiting_for_async_tool';

    try {
      const { event, metadata } = this.buildLifecycleEvent(operationId, state, reason);

      // Finalize the agent_operations row before user hooks fire so
      // downstream consumers see the row in its terminal shape.
      await this.persistCompletion(operationId, state, reason);

      if (isAsyncToolPark) return;

      await hookDispatcher.dispatch(operationId, 'onComplete', event, metadata._hooks);

      // Delivery checker: on a successful completion, run the confirmed verify
      // plan against the deliverable. Fire-and-forget and self-guarded — a run
      // without an opted-in plan is a no-op, and failures never affect the run.
      if (reason === 'done') {
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
        if (assistantMessageId && state?.error) {
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
      if (!isAsyncToolPark) hookDispatcher.unregister(operationId);
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
      .find((m: { content?: unknown; role: string }) => m.role === 'assistant');
    const lastAssistantContent = lastAssistantMessage
      ? extractTextFromMessageContent(lastAssistantMessage.content)
      : undefined;

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
