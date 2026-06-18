import { describe, expect, it } from 'vitest';

import type { SubagentIntent } from '../subagentCoordinator';
import { createMainAgentRunState, reduceMainAgent } from './index';
import type { MainAgentIntent, MainAgentReduceCtx, MainAgentRunState } from './types';

type AnyIntent = MainAgentIntent | SubagentIntent;

/** Deterministic id factory: `thd_1`, `msg_1`, `msg_2`, … per kind. */
const makeCtx = (over: Partial<MainAgentReduceCtx> = {}): MainAgentReduceCtx => {
  const counters = { message: 0, thread: 0 };
  return {
    agentId: 'agent-1',
    newId: (kind) => {
      counters[kind] += 1;
      return `${kind === 'thread' ? 'thd' : 'msg'}_${counters[kind]}`;
    },
    topicId: 'topic-1',
    ...over,
  };
};

// ─── Event builders ───

const initEvent = (model?: string, provider?: string) => ({
  data: { model, newStep: false, provider },
  type: 'stream_start',
});

const newStepEvent = (externalSignal?: any) => ({
  data: { externalSignal, newStep: true },
  type: 'stream_start',
});

const textEvent = (content: string, extra: Record<string, any> = {}) => ({
  data: { chunkType: 'text', content, ...extra },
  type: 'stream_chunk',
});

const reasoningEvent = (reasoning: string) => ({
  data: { chunkType: 'reasoning', reasoning },
  type: 'stream_chunk',
});

const tool = (id: string) => ({
  apiName: 'Bash',
  arguments: '{}',
  id,
  identifier: 'bash',
  type: 'default',
});

const toolsEvent = (tools: any[]) => ({
  data: { chunkType: 'tools_calling', toolsCalling: tools },
  type: 'stream_chunk',
});

const toolResultEvent = (toolCallId: string, content: string, extra: Record<string, any> = {}) => ({
  data: { content, toolCallId, ...extra },
  type: 'tool_result',
});

const turnMetaEvent = (model?: string, provider?: string, usage?: any) => ({
  data: { model, phase: 'turn_metadata', provider, usage },
  type: 'step_complete',
});

const stdoutSignal = (seq: number) => ({
  sequence: seq,
  sourceToolCallId: 't1',
  sourceToolName: 'Monitor',
  type: 'tool-stdout',
});

const kinds = (intents: AnyIntent[]) => intents.map((i) => i.kind);
const ofKind = <K extends AnyIntent['kind']>(intents: AnyIntent[], kind: K) =>
  intents.filter((i) => i.kind === kind) as Extract<AnyIntent, { kind: K }>[];

/** Apply events with commit-on-success; return final state + per-step intents. */
const run = (events: { data?: any; type?: string }[], seed = 'A0', ctx = makeCtx()) => {
  let state = createMainAgentRunState(seed);
  const steps: AnyIntent[][] = [];
  for (const e of events) {
    const r = reduceMainAgent(state, e, ctx);
    steps.push(r.intents);
    state = r.state; // commit
  }
  return { state, steps };
};

describe('main agent reducer', () => {
  it('stream_start init backfills model/provider onto the seed assistant', () => {
    const { steps } = run([initEvent('claude-sonnet-4-6', 'claude-code')]);
    expect(steps[0]).toEqual([
      {
        kind: 'persistAssistant',
        messageId: 'A0',
        model: 'claude-sonnet-4-6',
        provider: 'claude-code',
      },
    ]);
  });

  it('accumulates text and emits a live streamContent each chunk', () => {
    const { steps, state } = run([textEvent('Hello '), textEvent('world')]);
    expect(steps[0]).toEqual([{ content: 'Hello ', kind: 'streamContent', messageId: 'A0' }]);
    expect(steps[1]).toEqual([{ content: 'Hello world', kind: 'streamContent', messageId: 'A0' }]);
    expect(state.accContent).toBe('Hello world');
  });

  it('replace-mode text snapshots replace, and stale sequences are dropped', () => {
    const { steps, state } = run([
      textEvent('v2', { snapshotMode: 'replace', snapshotSeq: 2 }),
      textEvent('v1-late', { snapshotMode: 'replace', snapshotSeq: 1 }), // stale → ignored
      textEvent('v3', { snapshotMode: 'replace', snapshotSeq: 3 }),
    ]);
    expect(steps[0]).toEqual([{ content: 'v2', kind: 'streamContent', messageId: 'A0' }]);
    expect(steps[1]).toEqual([]); // stale snapshot, no intent
    expect(steps[2]).toEqual([{ content: 'v3', kind: 'streamContent', messageId: 'A0' }]);
    expect(state.accContent).toBe('v3');
    expect(state.lastTextSnapshotSeq).toBe(3);
  });

  it('accumulates reasoning separately', () => {
    const { steps, state } = run([reasoningEvent('think '), reasoningEvent('more')]);
    expect(steps[1]).toEqual([{ kind: 'streamContent', messageId: 'A0', reasoning: 'think more' }]);
    expect(state.accReasoning).toBe('think more');
  });

  it('persists a tool batch with pre-allocated ids and isNew flags', () => {
    const { steps, state } = run([textEvent('let me run'), toolsEvent([tool('t1'), tool('t2')])]);
    const batch = ofKind(steps[1], 'persistToolBatch')[0];
    expect(batch.assistantMessageId).toBe('A0');
    expect(batch.content).toBe('let me run');
    expect(batch.tools).toEqual([
      { isNew: true, payload: tool('t1'), toolMessageId: 'msg_1' },
      { isNew: true, payload: tool('t2'), toolMessageId: 'msg_2' },
    ]);
    // per-turn pre-allocated map carries the interpreter's create ids
    expect(state.toolState.toolMsgIdByCallId.get('t1')).toBe('msg_1');
    expect(state.toolState.toolMsgIdByCallId.get('t2')).toBe('msg_2');
    expect(state.lastToolMsgIdEver).toBe('msg_2');
  });

  it('de-dupes tools on retry (commit-on-success idempotency)', () => {
    let state = createMainAgentRunState('A0');
    const ctx = makeCtx();
    const ev = toolsEvent([tool('t1')]);

    const first = reduceMainAgent(state, ev, ctx);
    expect(ofKind(first.intents, 'persistToolBatch')[0].tools[0].isNew).toBe(true);
    state = first.state; // commit

    // Replaying the SAME event must not create the tool again.
    const second = reduceMainAgent(state, ev, ctx);
    expect(ofKind(second.intents, 'persistToolBatch')[0].tools[0].isNew).toBe(false);
  });

  it('opens a new turn chained off the previous turn last tool', () => {
    const { steps } = run([
      textEvent('first'),
      toolsEvent([tool('t1')]), // → msg_1
      toolResultEvent('t1', 'ok'),
      newStepEvent(), // → new assistant msg_2, parent = msg_1
    ]);
    const flush = ofKind(steps[3], 'persistAssistant')[0];
    expect(flush).toMatchObject({ content: 'first', messageId: 'A0' });
    const created = ofKind(steps[3], 'createAssistant')[0];
    expect(created).toMatchObject({ messageId: 'msg_2', parentId: 'msg_1' });
  });

  // ─── The 断链 regression: toolless reactive (Monitor) turns must NOT fork ───
  it('re-mounts toolless signal turns onto the source tool, not the prior assistant', () => {
    const { steps, state } = run([
      textEvent('watching build'),
      toolsEvent([tool('t1')]), // Monitor → msg_1
      newStepEvent(stdoutSignal(1)), // reactive toolless turn A → msg_2
      textEvent('build started'),
      newStepEvent(stdoutSignal(2)), // reactive toolless turn B → msg_3
      textEvent('still compiling'),
      newStepEvent(), // natural continuation back to main work → msg_4
      toolsEvent([tool('t2')]), // → msg_5
    ]);

    const created = steps
      .flatMap((s) => ofKind(s, 'createAssistant'))
      .map((c) => ({ messageId: c.messageId, parentId: c.parentId, signalType: c.signal?.type }));

    // EVERY turn after the Monitor tool hangs off msg_1 (the source tool),
    // forming a flat fan-out — NOT a linear msg_2 → msg_3 → msg_4 chain that
    // collectAssistantChain would sever at the first signal-tagged assistant.
    expect(created).toEqual([
      { messageId: 'msg_2', parentId: 'msg_1', signalType: 'tool-stdout' },
      { messageId: 'msg_3', parentId: 'msg_1', signalType: 'tool-stdout' },
      { messageId: 'msg_4', parentId: 'msg_1', signalType: undefined },
    ]);
    // The next real tool advances the chain fallback forward.
    expect(state.lastToolMsgIdEver).toBe('msg_5');
  });

  it('falls back to the current assistant only before any tool exists', () => {
    const { steps } = run([textEvent('hi'), newStepEvent()]); // no tool ever seen
    expect(ofKind(steps[1], 'createAssistant')[0]).toMatchObject({
      messageId: 'msg_1',
      parentId: 'A0',
    });
  });

  it('resolves a main tool_result via the global tool map', () => {
    const { steps } = run([
      toolsEvent([tool('t1')]),
      toolResultEvent('t1', 'done', { isError: false, pluginState: { todos: [] } }),
    ]);
    expect(steps[1]).toEqual([
      {
        content: 'done',
        isError: false,
        kind: 'resolveToolResult',
        pluginState: { todos: [] },
        toolCallId: 't1',
      },
    ]);
  });

  it('records turn metadata and carries model/provider across turns', () => {
    const { steps, state } = run([
      turnMetaEvent('claude-opus-4-8', 'claude-code', { totalTokens: 9 }),
    ]);
    expect(steps[0]).toEqual([
      {
        kind: 'recordUsage',
        messageId: 'A0',
        model: 'claude-opus-4-8',
        provider: 'claude-code',
        usage: { totalTokens: 9 },
      },
    ]);
    expect(state.turnModel).toBe('claude-opus-4-8');
    expect(state.turnProvider).toBe('claude-code');
  });

  it('flushes the open turn on a terminal event', () => {
    const { steps, state } = run([
      textEvent('final answer'),
      { data: {}, type: 'agent_runtime_end' },
    ]);
    expect(ofKind(steps[1], 'persistAssistant')[0]).toMatchObject({
      content: 'final answer',
      messageId: 'A0',
    });
    expect(state.ended).toBe(true);
    expect(state.accContent).toBe(''); // reset → idempotent re-finalize
  });

  it('suppresses echoed content and stamps the error on AuthRequired terminal error', () => {
    const stderr = 'invalid api key';
    const { steps } = run([
      textEvent(stderr), // CC echoed the stderr line into content
      { data: { code: 'AuthRequired', message: 'auth failed', stderr }, type: 'error' },
    ]);
    const persisted = ofKind(steps[1], 'persistAssistant')[0];
    expect(persisted.content).toBe(''); // cleared (echo)
    const setError = ofKind(steps[1], 'setError')[0];
    expect(setError).toMatchObject({ clearContent: true, messageId: 'A0' });
  });

  it('keeps content on a non-echo error', () => {
    const { steps } = run([
      textEvent('partial progress'),
      { data: { code: 'AuthRequired', stderr: 'totally different' }, type: 'error' },
    ]);
    expect(ofKind(steps[1], 'persistAssistant')[0].content).toBe('partial progress');
    expect(ofKind(steps[1], 'setError')[0].clearContent).toBe(false);
  });

  it('delegates subagent-tagged events to the subagent coordinator', () => {
    const subEvent = {
      data: {
        chunkType: 'text',
        content: 'investigating',
        subagent: {
          parentToolCallId: 'task-1',
          spawnMetadata: { description: 'Find bug', prompt: 'go', subagentType: 'explorer' },
          subagentMessageId: 'm1',
        },
      },
      type: 'stream_chunk',
    };
    const { steps, state } = run([subEvent]);
    // Subagent lazy-create intents come through unchanged.
    expect(kinds(steps[0])).toEqual([
      'createThread',
      'createMessage',
      'createMessage',
      'streamContent',
    ]);
    // Main thread state is untouched; the run now owns one subagent run.
    expect(state.currentAssistantId).toBe('A0');
    expect(state.subagents.runs.size).toBe(1);
  });

  it('finalizes a subagent run on its parent-spawn tool_result (main-scoped)', () => {
    // Seed a subagent run, then deliver the Task tool_result on the main thread.
    const subEvent = {
      data: {
        chunkType: 'text',
        content: 'done investigating',
        subagent: { parentToolCallId: 'task-1', subagentMessageId: 'm1' },
      },
      type: 'stream_chunk',
    };
    const { steps } = run([subEvent, toolResultEvent('task-1', 'subagent summary')]);
    // tool_result yields BOTH the main resolve and the subagent finalize.
    expect(kinds(steps[1])).toContain('resolveToolResult'); // main tool message content
    expect(kinds(steps[1])).toContain('finalizeThread'); // subagent run closed
  });

  it('never mutates the input state (pure reduce)', () => {
    const state: MainAgentRunState = createMainAgentRunState('A0');
    const before = JSON.stringify({
      acc: state.accContent,
      ever: state.lastToolMsgIdEver,
      tools: [...state.toolState.toolMsgIdByCallId],
    });
    reduceMainAgent(state, toolsEvent([tool('t1')]), makeCtx());
    const after = JSON.stringify({
      acc: state.accContent,
      ever: state.lastToolMsgIdEver,
      tools: [...state.toolState.toolMsgIdByCallId],
    });
    expect(after).toBe(before);
  });
});

// A `newStep` carries the turn's CC message.id; the reducer records it as the
// turn idempotency key and dedupes a replay (cold-replica BatchIngester retry).
const newStepWithId = (messageId?: string) => ({
  data: { messageId, newStep: true },
  type: 'stream_start',
});

describe('reduceMainAgent — newStep idempotency key', () => {
  it('opens a turn on a new message.id and records it as currentMainMessageId', () => {
    const { state, steps } = run([textEvent('first'), newStepWithId('M2')]);
    const created = ofKind(steps[1], 'createAssistant');
    expect(created).toHaveLength(1);
    expect(created[0].mainMessageId).toBe('M2');
    expect(state.currentMainMessageId).toBe('M2');
    expect(state.currentAssistantId).toBe('msg_1');
  });

  it('does NOT open a second assistant when the SAME message.id newStep is replayed', () => {
    const { state, steps } = run([
      textEvent('first'),
      newStepWithId('M2'), // opens msg_1
      newStepWithId('M2'), // replay (cold-replica retry) → must be a no-op
    ]);
    expect(ofKind(steps[1], 'createAssistant')).toHaveLength(1);
    expect(ofKind(steps[2], 'createAssistant')).toHaveLength(0);
    expect(steps[2]).toEqual([]);
    // Still anchored on the single turn assistant — no fork.
    expect(state.currentAssistantId).toBe('msg_1');
  });

  it('still opens a genuine new turn when the message.id changes', () => {
    const { state, steps } = run([textEvent('first'), newStepWithId('M2'), newStepWithId('M3')]);
    expect(ofKind(steps[1], 'createAssistant')).toHaveLength(1);
    expect(ofKind(steps[2], 'createAssistant')).toHaveLength(1);
    expect(state.currentMainMessageId).toBe('M3');
    expect(state.currentAssistantId).toBe('msg_2');
  });

  it('falls back to opening a turn when no message.id is present (legacy events)', () => {
    const { steps } = run([textEvent('first'), newStepWithId(undefined)]);
    expect(ofKind(steps[1], 'createAssistant')).toHaveLength(1);
  });
});
