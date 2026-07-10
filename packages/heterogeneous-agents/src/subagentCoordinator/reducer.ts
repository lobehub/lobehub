import type { SubagentEventContext, ToolCallPayload } from '../types';
import { getEventScope } from './getEventScope';
import type {
  SubagentIntent,
  SubagentReduceCtx,
  SubagentRun,
  SubagentRunsState,
  SubagentTurnToolState,
} from './types';

/**
 * Pure, transactional subagent run reducer.
 *
 * `reduce(state, event, ctx)` returns the NEXT state plus the intents to apply
 * — it never mutates `state` in place. The caller commits the returned state
 * ONLY after the intents are successfully applied:
 *
 *   const { state: next, intents } = reduce(state, event, ctx);
 *   await applyIntents(intents);   // may throw / be best-effort
 *   state = next;                  // commit on success
 *
 * This commit-on-success contract subsumes the renderer's old
 * `pendingFlushTarget` error-recovery: if applying a flush fails and the caller
 * keeps the old state, the run is preserved with its accumulators intact and
 * `currentAssistantId` un-advanced, so a later finalize naturally retries
 * against the correct (original-turn) assistant. On the server, a throw leaves
 * the event unmarked so the CLI BatchIngester replays it against the old state.
 *
 * Finalize DELETES the run (server-style). This unifies the two engines' old
 * divergent idempotency strategies (server deleted; renderer relied on cleared
 * accumulators) onto one: a second finalize / orphan drain finds no run and is
 * a clean no-op, with the same DB end-state (thread Active, terminal once).
 */

// ─── State copy helpers (structural sharing) ───

const copyToolState = (s: SubagentTurnToolState): SubagentTurnToolState => ({
  payloads: s.payloads.map((p) => ({ ...p })),
  persistedIds: new Set(s.persistedIds),
  toolMsgIdByCallId: new Map(s.toolMsgIdByCallId),
});

const emptyToolState = (): SubagentTurnToolState => ({
  payloads: [],
  persistedIds: new Set(),
  toolMsgIdByCallId: new Map(),
});

const copyRun = (run: SubagentRun): SubagentRun => ({
  ...run,
  lifetimeToolCallIds: new Set(run.lifetimeToolCallIds),
  toolState: copyToolState(run.toolState),
});

/** Clone the runs map, deep-copying only the run we're about to mutate. */
const withRun = (
  state: SubagentRunsState,
  parentToolCallId: string,
  run: SubagentRun,
): SubagentRunsState => {
  const runs = new Map(state.runs);
  runs.set(parentToolCallId, run);
  return { ...state, runs };
};

/**
 * Finalize bookkeeping: drop the live run AND remember its `parentToolCallId` in
 * `finalizedParents` so a replayed first-event never re-creates the (now
 * `Active`) thread. The remembered set is what makes thread creation idempotent
 * across cold-replica retries / double IPC delivery — keyed by the DB-homed
 * `sourceToolCallId`, independent of whether the live `runs` map still holds it.
 */
const markRunFinalized = (
  state: SubagentRunsState,
  parentToolCallId: string,
): SubagentRunsState => {
  const runs = new Map(state.runs);
  runs.delete(parentToolCallId);
  const finalizedParents = new Set(state.finalizedParents);
  finalizedParents.add(parentToolCallId);
  return { ...state, finalizedParents, runs };
};

const SUBAGENT_TITLE_MAX = 80;

interface ReduceResult {
  intents: SubagentIntent[];
  state: SubagentRunsState;
}

/**
 * Ensure a run exists for `subCtx.parentToolCallId` and its current turn
 * matches `subCtx.subagentMessageId`. Returns the (possibly new / turn-advanced)
 * run, the next state, and any structural intents (thread + message creates,
 * prior-turn flush). The returned `run` is a fresh copy safe to mutate further
 * by the caller before it calls `withRun` to fold it back into state.
 *
 * Returns `run: null` when the parent already FINALIZED (its thread is `Active`,
 * tracked in `finalizedParents`): the event is a stale replay of a completed
 * spawn — re-creating its thread would duplicate it. The caller drops the event.
 */
const ensureRun = (
  state: SubagentRunsState,
  subCtx: SubagentEventContext,
  ctx: SubagentReduceCtx,
): { intents: SubagentIntent[]; run: SubagentRun | null; state: SubagentRunsState } => {
  const intents: SubagentIntent[] = [];
  const existing = state.runs.get(subCtx.parentToolCallId);

  // ─── Stale replay of an already-finalized spawn → no-op (no duplicate thread) ───
  if (!existing && state.finalizedParents.has(subCtx.parentToolCallId)) {
    return { intents, run: null, state };
  }

  // ─── First event for this parent → lazy-create Thread + seed + assistant ───
  if (!existing) {
    const threadId = ctx.newId('thread');
    const userMsgId = ctx.newId('message');
    const firstAssistantId = ctx.newId('message');
    const { spawnMetadata } = subCtx;
    const title =
      spawnMetadata?.description?.slice(0, SUBAGENT_TITLE_MAX) ||
      spawnMetadata?.subagentType ||
      'Subagent';

    intents.push(
      {
        kind: 'createThread',
        parentToolCallId: subCtx.parentToolCallId,
        sourceMessageId: ctx.mainAssistantId,
        sourceToolCallId: subCtx.parentToolCallId,
        subagentType: spawnMetadata?.subagentType,
        threadId,
        title,
        topicId: ctx.topicId,
      },
      {
        agentId: ctx.agentId,
        content: spawnMetadata?.prompt ?? '',
        kind: 'createMessage',
        messageId: userMsgId,
        parentId: ctx.mainAssistantId,
        role: 'user',
        threadId,
        topicId: ctx.topicId,
      },
      {
        agentId: ctx.agentId,
        content: '',
        kind: 'createMessage',
        messageId: firstAssistantId,
        parentId: userMsgId,
        role: 'assistant',
        subagentMessageId: subCtx.subagentMessageId,
        threadId,
        topicId: ctx.topicId,
      },
    );

    const run: SubagentRun = {
      accContent: '',
      accReasoning: '',
      currentAssistantId: firstAssistantId,
      currentSubagentMessageId: subCtx.subagentMessageId ?? '',
      lastChainParentId: firstAssistantId,
      lifetimeToolCallIds: new Set(),
      threadId,
      toolState: emptyToolState(),
    };
    return { intents, run, state: withRun(state, subCtx.parentToolCallId, run) };
  }

  const run = copyRun(existing);

  // ─── Turn boundary (new subagentMessageId) → flush prior turn + new assistant ───
  if (subCtx.subagentMessageId && subCtx.subagentMessageId !== run.currentSubagentMessageId) {
    if (run.accContent || run.accReasoning) {
      intents.push({
        content: run.accContent || undefined,
        kind: 'persistContent',
        messageId: run.currentAssistantId,
        reasoning: run.accReasoning || undefined,
        threadId: run.threadId,
      });
    }

    const nextAssistantId = ctx.newId('message');
    intents.push({
      agentId: ctx.agentId,
      content: '',
      kind: 'createMessage',
      messageId: nextAssistantId,
      parentId: run.lastChainParentId,
      role: 'assistant',
      subagentMessageId: subCtx.subagentMessageId,
      threadId: run.threadId,
      topicId: ctx.topicId,
    });

    run.currentAssistantId = nextAssistantId;
    run.currentSubagentMessageId = subCtx.subagentMessageId;
    run.lastChainParentId = nextAssistantId;
    run.toolState = emptyToolState();
    run.accContent = '';
    run.accReasoning = '';
  }

  return { intents, run, state: withRun(state, subCtx.parentToolCallId, run) };
};

/**
 * Finalize a run: flush trailing content, optionally write a terminal assistant
 * (when `resultContent` is provided — the parent tool_result's answer), mark the
 * Thread Active, and DELETE the run. Called with `resultContent` from the parent
 * tool_result, and without it from terminal orphan drain.
 */
const finalizeRun = (
  state: SubagentRunsState,
  parentToolCallId: string,
  resultContent: string | undefined,
  ctx: SubagentReduceCtx,
): ReduceResult => {
  const existing = state.runs.get(parentToolCallId);
  if (!existing) return { intents: [], state };

  const intents: SubagentIntent[] = [];
  const run = copyRun(existing);

  if (run.accContent || run.accReasoning) {
    intents.push({
      content: run.accContent || undefined,
      kind: 'persistContent',
      messageId: run.currentAssistantId,
      reasoning: run.accReasoning || undefined,
      threadId: run.threadId,
    });
    run.accContent = '';
    run.accReasoning = '';
  }

  if (resultContent) {
    const terminalId = ctx.newId('message');
    intents.push({
      agentId: ctx.agentId,
      content: resultContent,
      kind: 'createMessage',
      messageId: terminalId,
      parentId: run.lastChainParentId,
      role: 'assistant',
      threadId: run.threadId,
      topicId: ctx.topicId,
    });
    run.currentAssistantId = terminalId;
    run.lastChainParentId = terminalId;
  }

  intents.push({ kind: 'finalizeThread', threadId: run.threadId });

  return { intents, state: markRunFinalized(state, parentToolCallId) };
};

/** Find the run that owns an inner tool_call id (lifetime lookup). */
const findRunByInnerToolCallId = (
  state: SubagentRunsState,
  toolCallId: string,
): { parentToolCallId: string; run: SubagentRun } | undefined => {
  for (const [parentToolCallId, run] of state.runs) {
    if (run.lifetimeToolCallIds.has(toolCallId)) return { parentToolCallId, run };
  }
  return undefined;
};

const reduceTextChunk = (
  state: SubagentRunsState,
  subCtx: SubagentEventContext,
  kind: 'text' | 'reasoning',
  chunk: string,
  ctx: SubagentReduceCtx,
): ReduceResult => {
  const ensured = ensureRun(state, subCtx, ctx);
  const run = ensured.run;
  const intents = ensured.intents;
  // Stale replay of a finalized spawn — drop without re-creating its thread.
  if (!run) return { intents, state: ensured.state };

  if (kind === 'text') run.accContent += chunk;
  else run.accReasoning += chunk;

  intents.push({
    kind: 'streamContent',
    messageId: run.currentAssistantId,
    threadId: run.threadId,
    ...(kind === 'text' ? { content: run.accContent } : { reasoning: run.accReasoning }),
  });

  return { intents, state: withRun(ensured.state, subCtx.parentToolCallId, run) };
};

const reduceToolsChunk = (
  state: SubagentRunsState,
  subCtx: SubagentEventContext,
  tools: ToolCallPayload[],
  ctx: SubagentReduceCtx,
): ReduceResult => {
  const ensured = ensureRun(state, subCtx, ctx);
  const run = ensured.run;
  const intents = ensured.intents;
  // Stale replay of a finalized spawn — drop without re-creating its thread.
  if (!run) return { intents, state: ensured.state };

  const newToolMsgIds: string[] = [];
  for (const tool of tools) {
    // Run-lifetime de-dupe FIRST: a tool already persisted anywhere in this run
    // must never be re-created. Per-turn `persistedIds` is reset on every turn
    // boundary — and starts empty after a cold-replica rehydration — so it alone
    // would let a replayed / continued `tools_calling` mint a SECOND tool message
    // for an id the run already wrote (duplicate inner-tool row in the thread).
    // `lifetimeToolCallIds` survives turn boundaries and is restored from DB on
    // rehydration, so it is the durable de-dupe key. (Checked BEFORE the
    // add-to-lifetime loop below, which would otherwise mark this batch's ids as
    // already-seen and skip everything.)
    if (run.lifetimeToolCallIds.has(tool.id)) continue;
    if (run.toolState.persistedIds.has(tool.id)) continue;
    run.toolState.persistedIds.add(tool.id);
    run.toolState.payloads.push({
      apiName: tool.apiName,
      arguments: tool.arguments,
      id: tool.id,
      identifier: tool.identifier,
      type: tool.type,
    });
    const toolMessageId = ctx.newId('message');
    run.toolState.toolMsgIdByCallId.set(tool.id, toolMessageId);
    newToolMsgIds.push(toolMessageId);
  }

  for (const tool of tools) run.lifetimeToolCallIds.add(tool.id);

  intents.push({
    assistantMessageId: run.currentAssistantId,
    content: run.accContent || undefined,
    kind: 'persistToolBatch',
    reasoning: run.accReasoning || undefined,
    subagentMessageId: run.currentSubagentMessageId || undefined,
    threadId: run.threadId,
    tools: run.toolState.payloads.map((p) => ({
      isNew: newToolMsgIds.includes(run.toolState.toolMsgIdByCallId.get(p.id)!),
      payload: { ...p },
      toolMessageId: run.toolState.toolMsgIdByCallId.get(p.id)!,
    })),
  });

  // Chain rule: the next turn's assistant parents off the
  // prior assistant (the spine), NOT this batch's last tool — so
  // `lastChainParentId` stays at `currentAssistantId` here, tools become inline
  // children, and the read side reconstructs the zigzag. (Subagent threads have
  // no signal/reactive turns, so there is no tool-anchor exception.)

  return { intents, state: withRun(ensured.state, subCtx.parentToolCallId, run) };
};

/**
 * Reduce a single stream event. Returns the next state and intents to apply.
 *
 * The caller routes an event here when it is subagent-tagged, OR it is a
 * `tool_result` (to catch the parent-spawn finalize whose tool_result is
 * main-scoped), OR it is a terminal event (orphan drain). For any event that
 * doesn't concern a subagent run, it returns `{ state, intents: [] }` unchanged
 * so the caller's main-agent path still owns it.
 */
export const reduce = (
  state: SubagentRunsState,
  event: { data?: any; type?: string },
  ctx: SubagentReduceCtx,
): ReduceResult => {
  const type = event.type;
  const data = event.data ?? {};

  if (type === 'stream_chunk') {
    const scope = getEventScope(event);
    if (scope.kind !== 'subagent') return { intents: [], state };
    const subCtx = scope.ctx;

    if (data.chunkType === 'text' && typeof data.content === 'string' && data.content) {
      return reduceTextChunk(state, subCtx, 'text', data.content, ctx);
    }
    if (data.chunkType === 'reasoning' && typeof data.reasoning === 'string' && data.reasoning) {
      return reduceTextChunk(state, subCtx, 'reasoning', data.reasoning, ctx);
    }
    if (data.chunkType === 'tools_calling') {
      const tools = (data.toolsCalling as ToolCallPayload[] | undefined) ?? [];
      if (tools.length === 0) return { intents: [], state };
      return reduceToolsChunk(state, subCtx, tools, ctx);
    }
    return { intents: [], state };
  }

  if (type === 'tool_result') {
    const toolCallId: string | undefined = data.toolCallId;
    if (!toolCallId) return { intents: [], state };
    const content: string = data.content ?? '';

    // Parent-spawn tool_result (main-scoped): the subagent ended → finalize.
    if (state.runs.has(toolCallId)) {
      return finalizeRun(state, toolCallId, content, ctx);
    }

    // Inner subagent tool_result → resolve into its thread.
    const owner = findRunByInnerToolCallId(state, toolCallId);
    if (owner) {
      return {
        intents: [
          {
            content,
            isError: !!data.isError,
            kind: 'resolveToolResult',
            pluginState: data.pluginState,
            threadId: owner.run.threadId,
            toolCallId,
          },
        ],
        state,
      };
    }

    // A main-agent tool_result we don't own — caller's main path handles it.
    return { intents: [], state };
  }

  if (type === 'step_complete' && data.phase === 'turn_metadata') {
    const subCtx = data.subagent as SubagentEventContext | undefined;
    if (!subCtx || !data.usage) return { intents: [], state };
    const run = state.runs.get(subCtx.parentToolCallId);
    if (!run) return { intents: [], state };
    return {
      intents: [
        {
          kind: 'recordUsage',
          messageId: run.currentAssistantId,
          model: data.model,
          provider: data.provider,
          subagentMessageId: run.currentSubagentMessageId || undefined,
          threadId: run.threadId,
          usage: data.usage,
        },
      ],
      state,
    };
  }

  if (type === 'agent_runtime_end' || type === 'error') {
    // Orphan drain: finalize every run that never saw its parent tool_result
    // (flush only — no terminal assistant, no authoritative result).
    let next = state;
    const intents: SubagentIntent[] = [];
    for (const parentToolCallId of state.runs.keys()) {
      const r = finalizeRun(next, parentToolCallId, undefined, ctx);
      intents.push(...r.intents);
      next = r.state;
    }
    return { intents, state: next };
  }

  return { intents: [], state };
};
