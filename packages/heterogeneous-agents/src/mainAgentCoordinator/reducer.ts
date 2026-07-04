import type { SubagentIntent, SubagentReduceCtx } from '../subagentCoordinator';
import { getEventScope, reduceSubagentRuns } from '../subagentCoordinator';
import type { ToolCallPayload } from '../types';
import type {
  MainAgentIntent,
  MainAgentReduceCtx,
  MainAgentRunState,
  MainAgentTurnToolState,
} from './types';

/**
 * Pure, transactional main-agent run reducer. See `./types.ts` for the design.
 *
 * `reduce(state, event, ctx)` returns the NEXT state plus the intents to apply
 * — it never mutates `state` in place. The caller commits the returned state
 * ONLY after the intents are successfully applied (commit-on-success), so a
 * throwing intent leaves the run un-advanced and a retry replays against the
 * original state — the same resilience `reduceSubagentRuns` relies on.
 *
 * Subagent-scoped events (and the parent-spawn `tool_result` / terminal drain)
 * are delegated to `reduceSubagentRuns`; its intents are merged into the
 * returned list so a single call drives both the main thread and every nested
 * subagent.
 */

type AnyIntent = MainAgentIntent | SubagentIntent;

interface ReduceResult {
  intents: AnyIntent[];
  state: MainAgentRunState;
}

// ─── State copy helpers (structural sharing) ───

const copyToolState = (s: MainAgentTurnToolState): MainAgentTurnToolState => ({
  payloads: s.payloads.map((p) => ({ ...p })),
  persistedIds: new Set(s.persistedIds),
  toolMsgIdByCallId: new Map(s.toolMsgIdByCallId),
});

const emptyToolState = (): MainAgentTurnToolState => ({
  payloads: [],
  persistedIds: new Set(),
  toolMsgIdByCallId: new Map(),
});

/** Deep-copy the parts of state a handler may mutate; subagents is swapped wholesale. */
const copyState = (s: MainAgentRunState): MainAgentRunState => ({
  ...s,
  toolState: copyToolState(s.toolState),
  turnMetadata: { ...s.turnMetadata },
});

// ─── Echo suppression (pure; mirrors both engines' shouldSuppressTerminalErrorEcho) ───

const normalizeErrorText = (value?: string) => value?.replaceAll(/\s+/g, ' ').trim();

/**
 * CC sometimes streams the error string into `content` BEFORE emitting the
 * structured error event (e.g. AuthRequired echoes the stderr line). Only
 * suppress when the body is explicitly marked OR matches the AuthRequired code,
 * AND the trimmed strings are equal. Anything else stays — accidental partial
 * overlaps are not echo. Operates on the wire `error` event data
 * (`HeterogeneousTerminalErrorData`), so the decision is pure.
 */
const shouldSuppressTerminalErrorEcho = (content: string, errorData: unknown): boolean => {
  const body = errorData as
    | { clearEchoedContent?: boolean; code?: string; message?: string; stderr?: string }
    | undefined;
  // Keep in sync with the interpreters' ECHO_TRIGGER_CODES.
  if (!body?.clearEchoedContent && body?.code !== 'AuthRequired') return false;
  const normalizedContent = normalizeErrorText(content);
  const normalizedError = normalizeErrorText(body?.stderr || body?.message);
  return !!normalizedContent && !!normalizedError && normalizedContent === normalizedError;
};

// ─── Subagent delegation ───

const subagentCtx = (state: MainAgentRunState, ctx: MainAgentReduceCtx): SubagentReduceCtx => ({
  agentId: ctx.agentId,
  mainAssistantId: state.currentAssistantId,
  newId: ctx.newId,
  topicId: ctx.topicId,
});

/** Reduce an event through the nested subagent coordinator, folding its state back in. */
const delegateSubagent = (
  state: MainAgentRunState,
  event: { data?: any; type?: string },
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  const { intents, state: subState } = reduceSubagentRuns(
    state.subagents,
    event,
    subagentCtx(state, ctx),
  );
  return { intents, state: { ...state, subagents: subState } };
};

// ─── Chain rule ───

/**
 * Parent for the NEXT turn's assistant (write-side spine).
 *
 * Normal turns parent off the run's spine (`lastSpineMessageId`, the most recent
 * non-tool / non-signal main message) so the persisted shape is
 * `user → asst → asst …` with tools as inline children; the read side
 * reconstructs the zigzag.
 *
 * Signal / reactive toolless turns (Monitor stdout pushes etc.) are the one
 * exception: they parent off the run's most recent tool (`lastToolMsgIdEver`)
 * so the reader renders them as tool-child callbacks (`collectFlatSignalCallbacks`)
 * instead of spine turns. They fall back to the spine only before any tool has
 * been seen.
 */
const computeTurnParentId = (state: MainAgentRunState, data: any): string => {
  if (data?.externalSignal) return state.lastToolMsgIdEver ?? state.lastSpineMessageId;
  return state.lastSpineMessageId;
};

// ─── Per-event handlers ───

/** `stream_start { newStep: true }` — flush the prior turn, open a new assistant. */
const openTurn = (state: MainAgentRunState, data: any, ctx: MainAgentReduceCtx): ReduceResult => {
  const intents: AnyIntent[] = [];

  // 1. Durably flush the prior turn's accumulators + model/provider.
  const flush: Record<string, any> = {};
  if (state.accContent) flush.content = state.accContent;
  if (state.accReasoning) flush.reasoning = state.accReasoning;
  if (state.turnModel) flush.model = state.turnModel;
  if (state.turnProvider) flush.provider = state.turnProvider;
  if (Object.keys(flush).length > 0) {
    intents.push({ kind: 'persistAssistant', messageId: state.currentAssistantId, ...flush });
  }

  // 2. Open the new turn's assistant, chained off the spine (chain rule);
  //    signal/reactive turns parent off the last tool — see computeTurnParentId.
  const messageId = ctx.newId('message');
  const mainMessageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
  const isSignalTurn = !!data?.externalSignal;
  intents.push({
    agentId: ctx.agentId,
    kind: 'createAssistant',
    mainMessageId,
    messageId,
    model: state.turnModel,
    parentId: computeTurnParentId(state, data),
    provider: state.turnProvider,
    signal: data?.externalSignal,
    topicId: ctx.topicId,
  });

  // 3. Advance: model/provider carry across (a fresh turn_metadata overwrites).
  const next = copyState(state);
  next.currentAssistantId = messageId;
  // The spine only advances on NORMAL turns — a signal/reactive turn is a
  // tool-child callback, so the next normal turn re-mounts on the pre-callback
  // spine assistant, not on the callback.
  if (!isSignalTurn) next.lastSpineMessageId = messageId;
  next.currentMainMessageId = mainMessageId;
  next.accContent = '';
  next.accReasoning = '';
  next.lastTextSnapshotSeq = 0;
  next.turnMetadata = {};
  next.toolState = emptyToolState();
  return { intents, state: next };
};

/** First `stream_start` (no newStep) carries the CLI's authoritative model/provider. */
const streamInit = (state: MainAgentRunState, data: any): ReduceResult => {
  const update: Record<string, any> = {};
  if (data?.model) update.model = data.model;
  if (data?.provider) update.provider = data.provider;

  // The seeded assistant's CC message.id arrives on the first non-newStep
  // stream_start after system:init (the seed was opened with no id). Record it
  // as `currentMainMessageId` so the first turn's rows get `heteroMessageId`
  // provenance; `openTurn` owns it for every later turn. Only seed it once — a
  // later non-newStep stream_start must not clobber the open turn's id.
  const seedMainMessageId =
    typeof data?.messageId === 'string' && !state.currentMainMessageId
      ? data.messageId
      : undefined;

  if (Object.keys(update).length === 0 && !seedMainMessageId) return { intents: [], state };

  const next = copyState(state);
  if (data.model) next.turnModel = data.model;
  if (data.provider) next.turnProvider = data.provider;
  if (seedMainMessageId) next.currentMainMessageId = seedMainMessageId;
  return {
    intents:
      Object.keys(update).length > 0
        ? [{ kind: 'persistAssistant', messageId: state.currentAssistantId, ...update }]
        : [],
    state: next,
  };
};

const reduceTextChunk = (state: MainAgentRunState, data: any): ReduceResult => {
  const next = copyState(state);
  const snapshotMode = data?.snapshotMode;
  const snapshotSeq = typeof data?.snapshotSeq === 'number' ? data.snapshotSeq : undefined;

  if (snapshotMode === 'replace' && snapshotSeq !== undefined) {
    if (snapshotSeq <= state.lastTextSnapshotSeq) return { intents: [], state }; // stale snapshot
    next.lastTextSnapshotSeq = snapshotSeq;
    next.turnMetadata = { ...next.turnMetadata, heteroTextSnapshotSeq: snapshotSeq };
    next.accContent = data.content;
  } else {
    if (!data?.content) return { intents: [], state };
    next.accContent = state.accContent + data.content;
  }

  return {
    intents: [
      { content: next.accContent, kind: 'streamContent', messageId: next.currentAssistantId },
    ],
    state: next,
  };
};

const reduceReasoningChunk = (state: MainAgentRunState, data: any): ReduceResult => {
  if (!data?.reasoning) return { intents: [], state };
  const next = copyState(state);
  next.accReasoning = state.accReasoning + data.reasoning;
  return {
    intents: [
      { kind: 'streamContent', messageId: next.currentAssistantId, reasoning: next.accReasoning },
    ],
    state: next,
  };
};

const reduceToolsChunk = (
  state: MainAgentRunState,
  tools: ToolCallPayload[],
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  const next = copyState(state);
  const newToolMsgIds: string[] = [];

  for (const tool of tools) {
    if (next.toolState.persistedIds.has(tool.id)) continue;
    next.toolState.persistedIds.add(tool.id);
    next.toolState.payloads.push({
      apiName: tool.apiName,
      arguments: tool.arguments,
      id: tool.id,
      identifier: tool.identifier,
      type: tool.type,
    });
    const toolMessageId = ctx.newId('message');
    next.toolState.toolMsgIdByCallId.set(tool.id, toolMessageId);
    newToolMsgIds.push(toolMessageId);
  }

  const intents: AnyIntent[] = [
    {
      assistantMessageId: next.currentAssistantId,
      content: next.accContent || undefined,
      kind: 'persistToolBatch',
      reasoning: next.accReasoning || undefined,
      tools: next.toolState.payloads.map((p) => ({
        isNew: newToolMsgIds.includes(next.toolState.toolMsgIdByCallId.get(p.id)!),
        payload: { ...p },
        toolMessageId: next.toolState.toolMsgIdByCallId.get(p.id)!,
      })),
    },
  ];

  // Advance the chain fallback to this turn's last tool message.
  const lastToolMsgId = newToolMsgIds.at(-1);
  if (lastToolMsgId) next.lastToolMsgIdEver = lastToolMsgId;

  return { intents, state: next };
};

const reduceStreamChunk = (
  state: MainAgentRunState,
  data: any,
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  if (data?.chunkType === 'text' && typeof data.content === 'string') {
    return reduceTextChunk(state, data);
  }
  if (data?.chunkType === 'reasoning' && typeof data.reasoning === 'string') {
    return reduceReasoningChunk(state, data);
  }
  if (data?.chunkType === 'tools_calling') {
    const tools = (data.toolsCalling as ToolCallPayload[] | undefined) ?? [];
    if (tools.length === 0) return { intents: [], state };
    return reduceToolsChunk(state, tools, ctx);
  }
  return { intents: [], state };
};

/** Main-agent (and parent-spawn) tool_result. Inner subagent results are delegated. */
const reduceToolResult = (
  state: MainAgentRunState,
  event: { data?: any },
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  const data = event.data ?? {};
  const toolCallId: string | undefined = data.toolCallId;
  if (!toolCallId) return { intents: [], state };

  // Resolve the (main-scoped) tool message content, then delegate so a
  // parent-spawn tool_result finalizes its subagent run (no-op otherwise).
  const main: AnyIntent = {
    content: data.content ?? '',
    isError: !!data.isError,
    kind: 'resolveToolResult',
    pluginState: data.pluginState,
    toolCallId,
  };
  const delegated = delegateSubagent(state, event, ctx);
  return { intents: [main, ...delegated.intents], state: delegated.state };
};

const reduceTurnMetadata = (state: MainAgentRunState, data: any): ReduceResult => {
  const next = copyState(state);
  if (data?.model) next.turnModel = data.model;
  if (data?.provider) next.turnProvider = data.provider;
  const usage = data?.usage;
  if (usage) next.turnMetadata = { ...next.turnMetadata, usage };

  if (!data?.model && !data?.provider && !usage) return { intents: [], state: next };
  return {
    intents: [
      {
        kind: 'recordUsage',
        messageId: state.currentAssistantId,
        model: data?.model,
        provider: data?.provider,
        usage,
      },
    ],
    state: next,
  };
};

const reduceTerminal = (
  state: MainAgentRunState,
  event: { data?: any; type?: string },
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  const isError = event.type === 'error';
  const suppress = isError ? shouldSuppressTerminalErrorEcho(state.accContent, event.data) : false;

  const intents: AnyIntent[] = [];
  const flush: Record<string, any> = {};
  if (suppress) flush.content = '';
  else if (state.accContent) flush.content = state.accContent;
  if (state.accReasoning) flush.reasoning = state.accReasoning;
  if (state.turnModel) flush.model = state.turnModel;
  if (state.turnProvider) flush.provider = state.turnProvider;
  if (Object.keys(flush).length > 0) {
    intents.push({ kind: 'persistAssistant', messageId: state.currentAssistantId, ...flush });
  }
  if (isError) {
    intents.push({
      clearContent: suppress,
      errorData: event.data,
      kind: 'setError',
      messageId: state.currentAssistantId,
    });
  }

  // Reset accumulators so a follow-up terminal/flush is an idempotent no-op,
  // then drain any subagent runs that never saw their parent tool_result.
  const drained = copyState(state);
  drained.accContent = '';
  drained.accReasoning = '';
  drained.ended = true;
  const delegated = delegateSubagent(drained, event, ctx);
  return { intents: [...intents, ...delegated.intents], state: delegated.state };
};

/**
 * Reduce a single stream event. Returns the next state and intents to apply.
 * Subagent-scoped events are routed entirely through the subagent coordinator;
 * `tool_result` / terminal events run the main path AND delegate.
 */
export const reduce = (
  state: MainAgentRunState,
  event: { data?: any; type?: string },
  ctx: MainAgentReduceCtx,
): ReduceResult => {
  // Subagent-tagged chunks / turn_metadata belong wholly to the coordinator.
  if (getEventScope(event).kind === 'subagent') return delegateSubagent(state, event, ctx);

  const data = event.data ?? {};
  switch (event.type) {
    case 'stream_start': {
      if (!data?.newStep) return streamInit(state, data);
      // Idempotency: a `newStep` whose CC message.id matches the turn already
      // open is a REPLAY (BatchIngester retry reprocessed on a cold replica
      // with an empty in-memory `processedKeys`). Opening again would mint a
      // duplicate assistant and orphan the first as a usage-only empty shell.
      // The adapter only emits `newStep` when message.id CHANGES, so a genuine
      // new turn never collides with the current id.
      if (typeof data.messageId === 'string' && data.messageId === state.currentMainMessageId) {
        return { intents: [], state };
      }
      return openTurn(state, data, ctx);
    }
    case 'stream_chunk': {
      return reduceStreamChunk(state, data, ctx);
    }
    case 'tool_result': {
      return reduceToolResult(state, event, ctx);
    }
    case 'step_complete': {
      if (data?.phase === 'turn_metadata') return reduceTurnMetadata(state, data);
      return { intents: [], state };
    }
    case 'agent_runtime_end':
    case 'error': {
      return reduceTerminal(state, event, ctx);
    }
    default: {
      return { intents: [], state };
    }
  }
};
