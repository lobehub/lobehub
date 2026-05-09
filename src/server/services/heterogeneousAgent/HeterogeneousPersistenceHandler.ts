import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import {
  AgentRuntimeErrorType,
  type ChatMessageError,
  type ChatToolPayload,
  ThreadStatus,
  ThreadType,
} from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { ThreadModel } from '@/database/models/thread';
import type { TopicModel } from '@/database/models/topic';

const log = debug('lobe-server:hetero-agent:persistence');

const generateThreadId = () => `thd_${createNanoId(16)()}`;

/**
 * Stable 32-bit FNV-1a hash of a string. Cheap to compute, collision odds are
 * negligible at this scope (a few thousand events per operation), and the
 * output is short enough to keep the per-operation `processedKeys` set small.
 */
const fnv1a = (input: string): string => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV prime 0x01000193, applied via bit shifts to stay in 32-bit math.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
};

/**
 * Per-event idempotency key. CLI BatchIngester retries the SAME event objects
 * on transient failures, so the same `(stepIndex, type, data)` triple is
 * stable across retries — and distinct between back-to-back events even when
 * they share a millisecond timestamp.
 *
 * Why not just `(stepIndex, type, timestamp)`: producers stamp events with
 * `Date.now()` (see `claudeCode.ts` / `codex.ts` adapters), and CC bursts
 * multiple `stream_chunk` events through the same step within a single
 * millisecond. Without a content fingerprint, later chunks would collide with
 * earlier ones, get treated as duplicates, and be dropped — silently
 * truncating assistant output.
 *
 * Why not hash full `data`: tools_calling payloads can carry large argument
 * strings; a stable JSON.stringify on every event is cheap enough but the
 * resulting key would balloon the `processedKeys` set. Hashing keeps the key
 * bounded.
 */
const eventKey = (event: AgentStreamEvent): string => {
  // Fingerprint the data via stable JSON. Order is irrelevant — adapters
  // produce events with consistent key order, and even if they didn't, the
  // important property is "same event input → same output", which holds.
  const dataJson = (() => {
    try {
      return JSON.stringify(event.data ?? null);
    } catch {
      // Cyclic / unstringifiable payload: fall back to a coarse fingerprint.
      // Real wire data is always JSON-serializable, so this branch only fires
      // on bad test inputs.
      return String(typeof event.data);
    }
  })();
  return `${event.stepIndex}:${event.type}:${event.timestamp}:${fnv1a(dataJson)}`;
};

const normalizeErrorText = (value?: string) => value?.replaceAll(/\s+/g, ' ').trim();

/**
 * CC sometimes streams the error string into `content` BEFORE emitting the
 * structured error event (e.g. AuthRequired echoes the stderr line). Mirrors
 * the renderer's `shouldSuppressTerminalErrorEcho` (lines 113–130 of
 * heterogeneousAgentExecutor.ts): only suppress when the body is explicitly
 * marked or matches the AuthRequired code, AND the trimmed strings are
 * equal. Anything else stays — accidental partial overlaps are not echo.
 */
const shouldSuppressTerminalErrorEcho = (
  content: string,
  error: ChatMessageError | undefined,
): boolean => {
  if (!error) return false;
  const errorBody = error.body as
    | {
        clearEchoedContent?: boolean;
        code?: string;
        message?: string;
        stderr?: string;
      }
    | undefined;
  // The renderer guards on either an explicit flag or AuthRequired (the most
  // common echo source). Other error codes might echo too, but we err on the
  // side of preserving content unless the producer asks for the cleanup.
  const ECHO_TRIGGER_CODES = new Set(['AuthRequired']);
  if (
    !errorBody?.clearEchoedContent &&
    (!errorBody?.code || !ECHO_TRIGGER_CODES.has(errorBody.code))
  ) {
    return false;
  }
  const normalizedContent = normalizeErrorText(content);
  const normalizedError = normalizeErrorText(
    errorBody?.stderr || errorBody?.message || error.message,
  );
  return !!normalizedContent && !!normalizedError && normalizedContent === normalizedError;
};

interface ToolCallPayload extends ChatToolPayload {}

/** Per-assistant-message tool persistence state (main or sub-agent scope). */
interface ToolPersistenceState {
  payloads: ChatToolPayload[];
  persistedIds: Set<string>;
}

interface SubagentEventContext {
  parentToolCallId: string;
  spawnMetadata?: {
    description?: string;
    prompt?: string;
    subagentType?: string;
  };
  subagentMessageId?: string;
}

/**
 * Per-spawn subagent run state. Mirrors `SubagentRunState` in the renderer
 * (`src/store/chat/slices/aiChat/actions/heterogeneousAgentExecutor.ts`),
 * minus UI-only fields (`stream`, `subOperationId`, `pendingFlushTarget`).
 */
interface SubagentRunState {
  accumulatedContent: string;
  accumulatedReasoning: string;
  currentAssistantMsgId: string;
  currentSubagentMessageId: string;
  lastChainParentId: string;
  lifetimeToolCallIds: Set<string>;
  state: ToolPersistenceState;
  threadId: string;
}

/**
 * Per-operation in-memory state. Lifetime spans the whole CLI run from first
 * `heteroIngest` batch through `heteroFinish`. Multi-replica caveat: state is
 * per-Node-process; cloud sandbox routing must be sticky to a single replica
 * for one operationId, otherwise turn boundaries on the second replica will
 * lose the chain-parent and pre-existing tool map. (Phase 3 sandbox owns the
 * endpoint per-instance, so this is not a problem in practice.)
 */
interface OperationState {
  accumulatedContent: string;
  accumulatedReasoning: string;
  agentId: string | null;
  currentAssistantMessageId: string;
  lastModel: string | undefined;
  lastProvider: string | undefined;
  operationId: string;
  processedKeys: Set<string>;
  subagentRuns: Map<string, SubagentRunState>;
  toolMsgIdByCallId: Map<string, string>;
  toolState: ToolPersistenceState;
  topicId: string;
}

/**
 * Module-level singleton: `Map<operationId, OperationState>`. Service
 * instances are constructed per-request via the tRPC procedure middleware,
 * so per-instance state would not survive across requests. Keying off the
 * shared map lets two ingest batches for the same operationId share their
 * tool map / accumulated content / subagent runs.
 */
const operationStates = new Map<string, OperationState>();

/** Test-only reset hook to clear the singleton between specs. */
export const __resetOperationStatesForTesting = () => operationStates.clear();

export interface HeterogeneousPersistenceHandlerDeps {
  messageModel: MessageModel;
  threadModel: ThreadModel;
  topicModel: TopicModel;
}

/**
 * Server-side persistence for `lh hetero exec` event streams. Mirrors the
 * desktop renderer's `executeHeterogeneousAgent` (1.8k lines) for the DB
 * concerns only — IPC, store dispatch, notifications, refresh hooks all
 * live host-side and are intentionally absent here.
 *
 * Phase 2b scope:
 *
 *   1. 3-phase tool persist (assistant.tools[] pre-register → tool message
 *      create → backfill `result_msg_id`)
 *   2. Subagent thread + per-turn assistant chaining + finalize on parent
 *      tool_result
 *   3. Step boundary handling (new assistant per `stream_start { newStep }`)
 *   4. Per-turn metadata persistence (`step_complete` w/ `phase=turn_metadata`)
 *   5. Final content / reasoning flush on `agent_runtime_end` / `error`
 *
 * Failure semantics (differs from the renderer's optimistic UI posture):
 *
 *   - DB writes propagate exceptions instead of swallowing them. A throw
 *     bubbles to `ingest`, leaving the offending event un-marked in
 *     `processedKeys` so the BatchIngester's outer retry replays it.
 *     Idempotent state updates (per-tool `persistedIds`, payload de-dup,
 *     `ThreadModel.onConflictDoNothing`) make replays safe.
 *   - Renderer-only "log + continue" no longer applies — the server is
 *     authoritative for cloud runs, so silent partial writes would diverge
 *     DB from what the WS subscribers see.
 *
 * Multi-replica caveat: state is per-Node-process. Cloud sandbox routing
 * must be sticky to a single replica per operationId, otherwise turn
 * boundaries on the second replica would lose the chain-parent and
 * pre-existing tool map. (Phase 3 sandbox owns the endpoint per-instance,
 * so this is not a problem in practice.)
 */
export class HeterogeneousPersistenceHandler {
  private readonly deps: HeterogeneousPersistenceHandlerDeps;

  constructor(deps: HeterogeneousPersistenceHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Process a batch of events for an operation. Sequential within the batch.
   *
   * Idempotency contract: an event is marked `processed` ONLY after its
   * handler resolves cleanly. If a handler throws, the event stays unmarked
   * so a follow-up retry processes it again, and the throw bubbles to
   * `heteroIngest` → tRPC → BatchIngester so the producer re-sends. Events
   * that already succeeded earlier in the batch are skipped on retry via
   * the dedupe map, so the retry only re-runs the failed event onward.
   */
  async ingest(params: {
    events: AgentStreamEvent[];
    operationId: string;
    topicId: string;
  }): Promise<void> {
    const state = await this.loadOrCreateState(params.operationId, params.topicId);

    for (const event of params.events) {
      const key = eventKey(event);
      if (state.processedKeys.has(key)) {
        log('skip duplicate event %s op=%s', key, state.operationId);
        continue;
      }

      // NOTE: do NOT mark `processed` before the handler runs. Marking up
      // front would silently swallow event-level failures — the BatchIngester
      // would ack OK while DB state diverges from the renderer's view. Mark
      // only on success so a retry can complete the lost write.
      await this.handleEvent(state, event);
      state.processedKeys.add(key);
    }

    // Flush accumulated content after every batch so a subsequent replica
    // picking up this operation always sees the latest content in the DB,
    // even if it never processes a step boundary or terminal event.
    await this.flushBatchContent(state);
  }

  /**
   * Flush trailing accumulators, persist the CLI's native session id (when
   * present) for next-turn resume, and drop the per-operation state.
   *
   * Resume id source: CC's `--resume <sessionId>` token comes from the
   * adapter's cached `system:init.session_id`. The CLI surfaces it here as a
   * `heteroFinish` argument; we write it to `topic.metadata.heteroSessionId`
   * (the same field the desktop renderer uses), so the next CLI spawn for
   * this topic can include `--resume <id>`.
   */
  async finish(params: {
    error?: { message: string; type: string };
    operationId: string;
    result: 'success' | 'error' | 'cancelled';
    sessionId?: string;
  }): Promise<void> {
    const state = operationStates.get(params.operationId);
    if (!state) return;

    try {
      await this.flushFinalState(state, params.error, params.result);
      if (params.sessionId) {
        await this.persistSessionId(state.topicId, params.sessionId);
      }
    } finally {
      operationStates.delete(params.operationId);
    }
  }

  /**
   * Persist the CLI's native session id onto `topic.metadata.heteroSessionId`.
   * `TopicModel.updateMetadata` merges into existing JSONB so this does NOT
   * clobber `runningOperation` / `workingDirectory` / other peer fields.
   */
  private async persistSessionId(topicId: string, sessionId: string): Promise<void> {
    try {
      await this.deps.topicModel.updateMetadata(topicId, { heteroSessionId: sessionId });
      log('persisted sessionId topic=%s sessionId=%s', topicId, sessionId);
    } catch (err) {
      log('persistSessionId failed topic=%s err=%O', topicId, err);
    }
  }

  // ─── State management ────────────────────────────────────────────────────

  private async loadOrCreateState(operationId: string, topicId: string): Promise<OperationState> {
    let state = operationStates.get(operationId);
    if (state) {
      // Defensive: caller mismatch on topicId would corrupt persistence —
      // assert and throw rather than silently writing to the wrong topic.
      if (state.topicId !== topicId) {
        throw new Error(
          `Operation ${operationId} is already bound to topic ${state.topicId}, not ${topicId}`,
        );
      }
      return state;
    }

    const topic = await this.deps.topicModel.findById(topicId);
    const running = topic?.metadata?.runningOperation;
    if (!running || running.operationId !== operationId) {
      throw new Error(
        `No matching runningOperation on topic ${topicId} for operation ${operationId} — orchestrator must seed topic.metadata.runningOperation before ingest`,
      );
    }
    if (!running.assistantMessageId) {
      throw new Error(`runningOperation on topic ${topicId} is missing assistantMessageId`);
    }

    // Prefer the latest step's assistant message id (written by handleStepStart)
    // over the initial placeholder — so a new replica after a step boundary uses
    // the correct message rather than the stale initial one.
    // Guard: only use heteroCurrentMsgId when it belongs to THIS operation.
    // A stale value from a previous run must not override the new operation's
    // seeded assistantMessageId (P1 fix).
    const stored = topic.metadata?.heteroCurrentMsgId;
    const currentAssistantMessageId =
      stored?.operationId === running.operationId
        ? (stored.msgId ?? running.assistantMessageId)
        : running.assistantMessageId;

    // Restore toolMsgIdByCallId from the DB so tool_results that arrive on a
    // different replica than their tool_use can still be matched and persisted.
    const toolPlugins = await this.deps.messageModel.listMessagePluginsByTopic(topicId);
    const toolMsgIdByCallId = new Map<string, string>();
    for (const plugin of toolPlugins) {
      if (plugin.toolCallId) toolMsgIdByCallId.set(plugin.toolCallId, plugin.id);
    }

    // Restore in-progress accumulators and tool state from the current assistant
    // message so a cold replica (Vercel serverless — each request is a new process)
    // continues from where the previous request left off rather than overwriting
    // with an empty/shorter value. Without this, every ingest call would reset
    // accumulatedContent to '' and toolState.payloads to [], causing:
    //   - content truncation: warm instance writes "hello world", cold instance
    //     accumulates only " more text" and overwrites with that shorter string.
    //   - tool duplication: cold instance sees persistedIds={}, re-creates already-
    //     persisted tool messages, and overwrites assistant.tools[] with only the
    //     current batch's tools (losing all previous ones).
    const currentMsg = await this.deps.messageModel.findById(currentAssistantMessageId);
    const restoredContent = (currentMsg?.content ?? '') as string;
    const restoredReasoning = (currentMsg?.reasoning as { content?: string } | null)?.content ?? '';
    const restoredTools = (currentMsg?.tools ?? []) as ChatToolPayload[];
    const restoredPersistedIds = new Set(restoredTools.map((t) => t.id));

    state = {
      accumulatedContent: restoredContent,
      accumulatedReasoning: restoredReasoning,
      agentId: topic.agentId ?? null,
      currentAssistantMessageId,
      lastModel: undefined,
      lastProvider: undefined,
      operationId,
      processedKeys: new Set(),
      subagentRuns: new Map(),
      toolMsgIdByCallId,
      toolState: { payloads: restoredTools, persistedIds: restoredPersistedIds },
      topicId,
    };
    operationStates.set(operationId, state);
    log(
      'created state for operation %s on topic %s msgId=%s tools=%d restored(content=%d tools=%d)',
      operationId,
      topicId,
      currentAssistantMessageId,
      toolMsgIdByCallId.size,
      restoredContent.length,
      restoredTools.length,
    );
    return state;
  }

  // ─── Event dispatch ──────────────────────────────────────────────────────

  private async handleEvent(state: OperationState, event: AgentStreamEvent): Promise<void> {
    switch (event.type) {
      case 'tool_result': {
        await this.handleToolResult(state, event);
        return;
      }

      case 'step_complete': {
        if (event.data?.phase === 'turn_metadata') {
          await this.handleTurnMetadata(state, event);
        }
        return;
      }

      case 'stream_start': {
        if (event.data?.newStep) {
          await this.handleStepStart(state);
        }
        return;
      }

      case 'stream_chunk': {
        await this.handleStreamChunk(state, event);
        return;
      }

      case 'agent_runtime_end':
      case 'error': {
        await this.handleTerminal(state, event);
        return;
      }

      // tool_start / tool_end / step_start / stream_end / agent_runtime_init /
      // tool_execute / stream_retry: no-op — server only persists the
      // adapter-level events, lifecycle markers are renderer-side concerns.
      default: {
        return;
      }
    }
  }

  // ─── Per-event handlers ──────────────────────────────────────────────────

  private async handleTurnMetadata(state: OperationState, event: AgentStreamEvent) {
    const { model, provider, usage } = event.data ?? {};
    if (model) state.lastModel = model;
    if (provider) state.lastProvider = provider;
    if (!usage) return;

    await this.deps.messageModel.update(state.currentAssistantMessageId, {
      metadata: { usage },
    });
  }

  /**
   * `stream_start { newStep: true }` opens a new assistant turn within the
   * same operation. Mirrors renderer logic:
   *
   *   1. Flush prior assistant's accumulated content / reasoning / model
   *   2. Create the new assistant — chained off the last main-agent tool
   *      message (so the wire becomes `asst → tool → asst → tool → ...`),
   *      falling back to the prev assistant when the prior step had no tools
   *   3. Reset main-agent tool state (NOT the global `toolMsgIdByCallId` —
   *      late subagent tool_results from prior steps still resolve via it)
   */
  private async handleStepStart(state: OperationState) {
    const prevUpdate: Record<string, any> = {};
    if (state.accumulatedContent) prevUpdate.content = state.accumulatedContent;
    if (state.accumulatedReasoning) prevUpdate.reasoning = { content: state.accumulatedReasoning };
    if (state.lastModel) prevUpdate.model = state.lastModel;
    if (state.lastProvider) prevUpdate.provider = state.lastProvider;

    if (Object.keys(prevUpdate).length > 0) {
      await this.deps.messageModel.update(state.currentAssistantMessageId, prevUpdate);
    }

    const lastToolMsgId = [...state.toolState.payloads]
      .reverse()
      .find((p) => !!p.result_msg_id)?.result_msg_id;
    const stepParentId = lastToolMsgId || state.currentAssistantMessageId;

    const newMsg = await this.deps.messageModel.create({
      agentId: state.agentId ?? undefined,
      content: '',
      model: state.lastModel,
      parentId: stepParentId,
      provider: state.lastProvider,
      role: 'assistant',
      topicId: state.topicId,
    });

    // Persist BEFORE advancing in-memory state (P2 fix). If this write fails
    // transiently and the event is retried, state is still at the previous step
    // so handleStepStart re-creates the new message with the correct parent
    // rather than chaining off the partially-created one. The first attempt's
    // empty message becomes an orphan but does not corrupt the turn chain.
    await this.deps.topicModel.updateMetadata(state.topicId, {
      heteroCurrentMsgId: { msgId: newMsg.id, operationId: state.operationId },
    });

    // Advance state only after the DB write lands.
    state.currentAssistantMessageId = newMsg.id;
    state.accumulatedContent = '';
    state.accumulatedReasoning = '';
    state.toolState = { payloads: [], persistedIds: new Set() };
  }

  private async handleStreamChunk(state: OperationState, event: AgentStreamEvent) {
    const chunk = event.data ?? {};
    const subagentCtx = chunk.subagent as SubagentEventContext | undefined;

    if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
      if (subagentCtx) {
        await this.persistSubagentText(state, subagentCtx, 'text', chunk.content);
      } else {
        state.accumulatedContent += chunk.content;
      }
      return;
    }

    if (chunk.chunkType === 'reasoning' && typeof chunk.reasoning === 'string') {
      if (subagentCtx) {
        await this.persistSubagentText(state, subagentCtx, 'reasoning', chunk.reasoning);
      } else {
        state.accumulatedReasoning += chunk.reasoning;
      }
      return;
    }

    if (chunk.chunkType === 'tools_calling') {
      const tools = chunk.toolsCalling as ToolCallPayload[] | undefined;
      if (!tools?.length) return;

      if (subagentCtx) {
        await this.persistSubagentToolBatch(state, subagentCtx, tools);
      } else {
        await this.persistMainToolBatch(state, tools);
      }
    }
  }

  private async handleToolResult(state: OperationState, event: AgentStreamEvent) {
    const data = event.data ?? {};
    const toolCallId: string | undefined = data.toolCallId;
    if (!toolCallId) return;

    const content: string = data.content ?? '';
    const isError: boolean = !!data.isError;
    const pluginState: Record<string, any> | undefined = data.pluginState;

    const toolMsgId = state.toolMsgIdByCallId.get(toolCallId);
    if (toolMsgId) {
      await this.deps.messageModel.updateToolMessage(toolMsgId, {
        content,
        pluginError: isError ? { message: content } : undefined,
        pluginState,
      });
    } else {
      // Late-arriving result for a call we never saw the tool_use for is
      // recoverable on a follow-up batch (out-of-order delivery); log and
      // move on so the rest of the batch lands.
      log('tool_result for unknown toolCallId=%s op=%s', toolCallId, state.operationId);
    }

    // If this tool_result is for a subagent's spawning tool_use (parent
    // toolCallId matches a registered subagent run), the subagent ended —
    // finalize so its terminal assistant carries the authoritative result
    // before any subsequent step boundary swaps the main assistant.
    if (state.subagentRuns.has(toolCallId)) {
      await this.finalizeSubagentRun(state, toolCallId, content);
    }
  }

  private async handleTerminal(state: OperationState, event: AgentStreamEvent) {
    const isError = event.type === 'error';
    const messageError = isError ? this.toChatMessageError(event.data) : undefined;
    const suppressEcho =
      !!messageError && shouldSuppressTerminalErrorEcho(state.accumulatedContent, messageError);

    const updateValue: Record<string, any> = {};
    if (suppressEcho) {
      // CC sometimes streams the error string into `content` BEFORE emitting
      // the structured error event. When the two payloads echo each other,
      // surface only the structured error and clear the duplicate text.
      updateValue.content = '';
    } else if (state.accumulatedContent) {
      updateValue.content = state.accumulatedContent;
    }
    if (state.accumulatedReasoning) updateValue.reasoning = { content: state.accumulatedReasoning };
    if (state.lastModel) updateValue.model = state.lastModel;
    if (state.lastProvider) updateValue.provider = state.lastProvider;
    if (messageError) updateValue.error = messageError;

    if (Object.keys(updateValue).length > 0) {
      await this.deps.messageModel.update(state.currentAssistantMessageId, updateValue);
    }

    // Drain any subagent runs that never saw their parent tool_result (CLI
    // crashed mid-spawn, or main never closed the spawn). Flush only — no
    // terminal assistant since we don't have authoritative resultContent.
    for (const parentToolCallId of state.subagentRuns.keys()) {
      await this.finalizeSubagentRun(state, parentToolCallId, undefined);
    }

    // Reset accumulators so a `finish()` flush after a terminal event in the
    // stream is a no-op (idempotent finalize).
    state.accumulatedContent = '';
    state.accumulatedReasoning = '';
  }

  /** Final safety flush triggered by `heteroFinish`. */
  private async flushFinalState(
    state: OperationState,
    error: { message: string; type: string } | undefined,
    result: 'success' | 'error' | 'cancelled',
  ) {
    if (!state.accumulatedContent && !state.accumulatedReasoning && !error && result !== 'error') {
      // Nothing pending — terminal event already flushed in-stream.
      return;
    }

    const updateValue: Record<string, any> = {};
    if (state.accumulatedContent) updateValue.content = state.accumulatedContent;
    if (state.accumulatedReasoning) updateValue.reasoning = { content: state.accumulatedReasoning };
    if (error) {
      // `error.type` is a free-form string from the CLI; coerce to the
      // shared union via `as` since the runtime contract accepts arbitrary
      // values (renderer-side error classifier already does the same).
      const errType = (error.type ||
        AgentRuntimeErrorType.AgentRuntimeError) as ChatMessageError['type'];
      updateValue.error = {
        body: { message: error.message },
        message: error.message,
        type: errType,
      } satisfies ChatMessageError;
    }

    if (Object.keys(updateValue).length > 0) {
      await this.deps.messageModel.update(state.currentAssistantMessageId, updateValue);
    }
  }

  /**
   * Write accumulated content/reasoning to DB after every ingest batch.
   * This ensures a subsequent replica always finds the latest text in the DB
   * even if the current replica never processes a step-boundary or terminal
   * event (which are the normal flush triggers).
   */
  private async flushBatchContent(state: OperationState): Promise<void> {
    if (!state.accumulatedContent && !state.accumulatedReasoning) return;
    const update: Record<string, any> = {};
    if (state.accumulatedContent) update.content = state.accumulatedContent;
    if (state.accumulatedReasoning) update.reasoning = { content: state.accumulatedReasoning };
    await this.deps.messageModel.update(state.currentAssistantMessageId, update);
  }

  private toChatMessageError(data: unknown): ChatMessageError {
    if (typeof data === 'object' && data && 'message' in data) {
      const message =
        typeof (data as any).message === 'string' ? (data as any).message : 'Agent runtime error';
      return {
        body: data as Record<string, unknown>,
        message,
        type: AgentRuntimeErrorType.AgentRuntimeError,
      };
    }
    const message = typeof data === 'string' ? data : 'Agent runtime error';
    return {
      body: { message },
      message,
      type: AgentRuntimeErrorType.AgentRuntimeError,
    };
  }

  // ─── 3-phase tool persist (main agent) ───────────────────────────────────

  /**
   * Same shape as renderer's `persistToolBatch` (lines 319–411 in
   * `heterogeneousAgentExecutor.ts`):
   *
   *   1. Append fresh tools to `state.payloads`, write them on the assistant
   *      together with the latest streamed content / reasoning so DB stays
   *      in sync (no orphan-tool window once the parser sees them).
   *   2. Create a `role:'tool'` message per fresh tool_use, capture its DB
   *      id into the global `toolMsgIdByCallId` lookup, and write
   *      `result_msg_id` onto the matching `state.payloads` entry.
   *   3. Re-write `state.payloads` so phase 2's backfilled `result_msg_id`
   *      lands on the assistant row.
   *
   * Idempotent on retry: tool_use ids already in `state.persistedIds` are
   * skipped up front.
   */
  private async persistToolBatch(
    incoming: ToolCallPayload[],
    persistState: ToolPersistenceState,
    assistantMessageId: string,
    state: OperationState,
    snapshot: { content: string; reasoning: string },
    threadId?: string,
  ): Promise<{ newToolMsgIds: string[] }> {
    // Merge incoming tools into the payloads array, de-duped by id. On a
    // retry of the same event, payloads already has these entries — skip the
    // re-push to keep phase 1/3 writes idempotent.
    for (const tool of incoming) {
      if (!persistState.payloads.some((p) => p.id === tool.id)) {
        persistState.payloads.push({ ...tool });
      }
    }

    const buildUpdate = (): Record<string, any> => {
      const update: Record<string, any> = { tools: persistState.payloads };
      if (snapshot.content) update.content = snapshot.content;
      if (snapshot.reasoning) update.reasoning = { content: snapshot.reasoning };
      return update;
    };

    // ─── Phase 1: pre-register tools[] on the assistant ───
    // Idempotent re-write of the tools[] JSONB column. Throws propagate so
    // the outer ingest loop leaves the event un-marked → retry replays.
    await this.deps.messageModel.update(assistantMessageId, buildUpdate());

    // ─── Phase 2: create tool messages, capture ids ───
    // Only create rows for tools that haven't been persisted yet. On retry
    // after a phase 2 mid-batch failure, this skips the ones that already
    // landed (their ids are in `persistedIds`) and re-tries the rest.
    const newToolMsgIds: string[] = [];
    const freshForCreate = incoming.filter((t) => !persistState.persistedIds.has(t.id));
    for (const tool of freshForCreate) {
      const result = await this.deps.messageModel.create({
        agentId: state.agentId ?? undefined,
        content: '',
        parentId: assistantMessageId,
        plugin: {
          apiName: tool.apiName,
          arguments: tool.arguments,
          identifier: tool.identifier,
          type: tool.type,
        },
        role: 'tool',
        threadId: threadId ?? null,
        tool_call_id: tool.id,
        topicId: state.topicId,
      });
      // Mark persisted ONLY after the create resolves cleanly — a thrown
      // create leaves the id absent so retries re-attempt this tool.
      state.toolMsgIdByCallId.set(tool.id, result.id);
      persistState.persistedIds.add(tool.id);
      newToolMsgIds.push(result.id);
      const entry = persistState.payloads.find((p) => p.id === tool.id);
      if (entry) entry.result_msg_id = result.id;
    }

    // ─── Phase 3: backfill result_msg_id on assistant.tools[] ───
    // Always runs: even if every tool was already persisted in a prior call,
    // a phase 3 retry after a partial-failure replay needs to land the
    // up-to-date payloads. The write is idempotent (same JSONB).
    await this.deps.messageModel.update(assistantMessageId, buildUpdate());

    return { newToolMsgIds };
  }

  private async persistMainToolBatch(state: OperationState, tools: ToolCallPayload[]) {
    await this.persistToolBatch(tools, state.toolState, state.currentAssistantMessageId, state, {
      content: state.accumulatedContent,
      reasoning: state.accumulatedReasoning,
    });
  }

  // ─── Subagent thread + turn tracking ─────────────────────────────────────

  private async ensureSubagentRun(
    state: OperationState,
    subagentCtx: SubagentEventContext,
  ): Promise<SubagentRunState | undefined> {
    let run = state.subagentRuns.get(subagentCtx.parentToolCallId);

    // ─── First subagent event for this parent → lazy-create Thread ───
    if (!run) {
      const { spawnMetadata } = subagentCtx;
      const threadId = generateThreadId();
      const title =
        spawnMetadata?.description?.slice(0, 80) || spawnMetadata?.subagentType || 'Subagent';

      // Failures here propagate so a retry replays the lazy-create. The
      // run isn't registered in `subagentRuns` until all three rows land,
      // so a partial-failure retry re-attempts the whole sequence; the
      // ThreadModel.create uses `onConflictDoNothing` on id so re-running
      // with the same generated id is safe.
      await this.deps.threadModel.create({
        id: threadId,
        metadata: {
          sourceToolCallId: subagentCtx.parentToolCallId,
          startedAt: new Date().toISOString(),
          subagentType: spawnMetadata?.subagentType,
        },
        sourceMessageId: state.currentAssistantMessageId,
        status: ThreadStatus.Processing,
        title,
        topicId: state.topicId,
        type: ThreadType.Isolation,
      } as any);

      const userMsg = await this.deps.messageModel.create({
        agentId: state.agentId ?? undefined,
        content: spawnMetadata?.prompt ?? '',
        parentId: state.currentAssistantMessageId,
        role: 'user',
        threadId,
        topicId: state.topicId,
      });

      const firstAssistant = await this.deps.messageModel.create({
        agentId: state.agentId ?? undefined,
        content: '',
        parentId: userMsg.id,
        role: 'assistant',
        threadId,
        topicId: state.topicId,
      });

      run = {
        accumulatedContent: '',
        accumulatedReasoning: '',
        currentAssistantMsgId: firstAssistant.id,
        currentSubagentMessageId: subagentCtx.subagentMessageId ?? '',
        lastChainParentId: firstAssistant.id,
        lifetimeToolCallIds: new Set(),
        state: { payloads: [], persistedIds: new Set() },
        threadId,
      };
      state.subagentRuns.set(subagentCtx.parentToolCallId, run);
      return run;
    }

    // ─── New subagent turn → flush old content, cut a new assistant ───
    if (
      subagentCtx.subagentMessageId &&
      subagentCtx.subagentMessageId !== run.currentSubagentMessageId
    ) {
      if (run.accumulatedContent || run.accumulatedReasoning) {
        const update: Record<string, any> = {};
        if (run.accumulatedContent) update.content = run.accumulatedContent;
        if (run.accumulatedReasoning) update.reasoning = { content: run.accumulatedReasoning };
        await this.deps.messageModel.update(run.currentAssistantMsgId, update);
      }

      const nextAssistant = await this.deps.messageModel.create({
        agentId: state.agentId ?? undefined,
        content: '',
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: state.topicId,
      });
      run.currentAssistantMsgId = nextAssistant.id;
      run.currentSubagentMessageId = subagentCtx.subagentMessageId;
      run.lastChainParentId = nextAssistant.id;
      run.state = { payloads: [], persistedIds: new Set() };
      run.accumulatedContent = '';
      run.accumulatedReasoning = '';
    }

    return run;
  }

  private async persistSubagentText(
    state: OperationState,
    subagentCtx: SubagentEventContext,
    kind: 'text' | 'reasoning',
    chunk: string,
  ) {
    const run = await this.ensureSubagentRun(state, subagentCtx);
    if (!run) return;
    if (kind === 'text') run.accumulatedContent += chunk;
    else run.accumulatedReasoning += chunk;
  }

  private async persistSubagentToolBatch(
    state: OperationState,
    subagentCtx: SubagentEventContext,
    tools: ToolCallPayload[],
  ) {
    const run = await this.ensureSubagentRun(state, subagentCtx);
    if (!run) return;

    for (const tool of tools) run.lifetimeToolCallIds.add(tool.id);

    const { newToolMsgIds } = await this.persistToolBatch(
      tools,
      run.state,
      run.currentAssistantMsgId,
      state,
      { content: run.accumulatedContent, reasoning: run.accumulatedReasoning },
      run.threadId,
    );

    // Chain next turn's assistant off the LAST tool message of this batch —
    // mirrors main-agent step-boundary logic.
    const lastToolMsgId = newToolMsgIds.at(-1);
    if (lastToolMsgId) run.lastChainParentId = lastToolMsgId;
  }

  /**
   * Two-step finalization: flush trailing content on the current in-thread
   * assistant, then (when `resultContent` is provided) create a terminal
   * assistant carrying the authoritative summary so the thread always ends
   * with `... → tool → asst(result)`.
   *
   * `resultContent` is omitted when the spawn never closed (CLI crash);
   * called from `handleTerminal` to drain orphan runs without faking a
   * result.
   */
  private async finalizeSubagentRun(
    state: OperationState,
    parentToolCallId: string,
    resultContent: string | undefined,
  ) {
    const run = state.subagentRuns.get(parentToolCallId);
    if (!run) return;

    if (run.accumulatedContent || run.accumulatedReasoning) {
      const update: Record<string, any> = {};
      if (run.accumulatedContent) update.content = run.accumulatedContent;
      if (run.accumulatedReasoning) update.reasoning = { content: run.accumulatedReasoning };
      await this.deps.messageModel.update(run.currentAssistantMsgId, update);
      run.accumulatedContent = '';
      run.accumulatedReasoning = '';
    }

    if (resultContent) {
      const terminal = await this.deps.messageModel.create({
        agentId: state.agentId ?? undefined,
        content: resultContent,
        parentId: run.lastChainParentId,
        role: 'assistant',
        threadId: run.threadId,
        topicId: state.topicId,
      });
      run.currentAssistantMsgId = terminal.id;
      run.lastChainParentId = terminal.id;
    }

    // Mark the thread completed. Idempotent — re-running on a retry just
    // re-writes the same status; downstream UI badges are derived state.
    await this.deps.threadModel.update(run.threadId, { status: ThreadStatus.Active });

    state.subagentRuns.delete(parentToolCallId);
  }
}
