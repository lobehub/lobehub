import { describe, expect, it } from 'vitest';

import { createSubagentRunsState, reduceSubagentRuns } from './index';
import type { SubagentIntent, SubagentReduceCtx } from './types';

/** Deterministic id factory: `thd_1`, `msg_1`, `msg_2`, … per kind. */
const makeCtx = (over: Partial<SubagentReduceCtx> = {}): SubagentReduceCtx => {
  const counters = { message: 0, thread: 0 };
  return {
    agentId: 'agent-1',
    mainAssistantId: 'main-asst-1',
    newId: (kind) => {
      counters[kind] += 1;
      return `${kind === 'thread' ? 'thd' : 'msg'}_${counters[kind]}`;
    },
    topicId: 'topic-1',
    ...over,
  };
};

const sub = (parentToolCallId: string, subagentMessageId?: string, spawnMetadata?: any) => ({
  parentToolCallId,
  ...(subagentMessageId ? { subagentMessageId } : {}),
  ...(spawnMetadata ? { spawnMetadata } : {}),
});

const textEvent = (
  parentToolCallId: string,
  subagentMessageId: string,
  content: string,
  spawnMetadata?: any,
) => ({
  data: {
    chunkType: 'text',
    content,
    subagent: sub(parentToolCallId, subagentMessageId, spawnMetadata),
  },
  type: 'stream_chunk',
});

const toolsEvent = (parentToolCallId: string, subagentMessageId: string, tools: any[]) => ({
  data: {
    chunkType: 'tools_calling',
    subagent: sub(parentToolCallId, subagentMessageId),
    toolsCalling: tools,
  },
  type: 'stream_chunk',
});

const tool = (id: string) => ({
  apiName: 'Bash',
  arguments: '{}',
  id,
  identifier: 'bash',
  type: 'default',
});

const kinds = (intents: SubagentIntent[]) => intents.map((i) => i.kind);

/** Apply a sequence of events with commit-on-success and return the final state + per-step intents. */
const run = (events: { data?: any; type?: string }[], ctx = makeCtx()) => {
  let state = createSubagentRunsState();
  const steps: SubagentIntent[][] = [];
  for (const e of events) {
    const r = reduceSubagentRuns(state, e, ctx);
    steps.push(r.intents);
    state = r.state; // commit
  }
  return { state, steps };
};

describe('subagent reducer', () => {
  it('lazy-creates thread + user seed + first assistant on the first subagent chunk', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'Investigating', {
        description: 'Find bug',
        prompt: 'go find',
        subagentType: 'explorer',
      }),
    ]);

    expect(kinds(steps[0])).toEqual([
      'createThread',
      'createMessage',
      'createMessage',
      'streamContent',
    ]);
    const [createThread, userMsg, asstMsg, stream] = steps[0] as any[];

    expect(createThread).toMatchObject({
      sourceMessageId: 'main-asst-1',
      sourceToolCallId: 'task-1',
      subagentType: 'explorer',
      threadId: 'thd_1',
      title: 'Find bug',
      topicId: 'topic-1',
    });
    expect(userMsg).toMatchObject({
      content: 'go find',
      parentId: 'main-asst-1',
      role: 'user',
      messageId: 'msg_1',
    });
    expect(asstMsg).toMatchObject({
      content: '',
      parentId: 'msg_1',
      role: 'assistant',
      messageId: 'msg_2',
    });
    // text accumulates onto the first assistant (live, replace)
    expect(stream).toMatchObject({
      content: 'Investigating',
      messageId: 'msg_2',
      threadId: 'thd_1',
    });

    expect(state.runs.get('task-1')).toMatchObject({
      accContent: 'Investigating',
      currentAssistantId: 'msg_2',
      currentSubagentMessageId: 'm1',
      lastChainParentId: 'msg_2',
      threadId: 'thd_1',
    });
  });

  it('falls back to subagentType then "Subagent" for the thread title', () => {
    const a = run([textEvent('t', 'm', 'x', { subagentType: 'explorer' })]);
    expect((a.steps[0][0] as any).title).toBe('explorer');
    const b = run([textEvent('t', 'm', 'x')]);
    expect((b.steps[0][0] as any).title).toBe('Subagent');
  });

  it('accumulates text as replace snapshots across chunks within a turn', () => {
    const { steps } = run([
      textEvent('task-1', 'm1', 'Hello '),
      textEvent('task-1', 'm1', 'world'),
    ]);
    // 2nd chunk: no new thread/message, just a streamContent carrying the full accumulation
    expect(kinds(steps[1])).toEqual(['streamContent']);
    expect((steps[1][0] as any).content).toBe('Hello world');
  });

  it('persists a tool batch with pre-allocated ids, isNew flags, and advances the chain', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'thinking'),
      toolsEvent('task-1', 'm1', [tool('tc-1'), tool('tc-2')]),
    ]);

    const batch = steps[1].find((i) => i.kind === 'persistToolBatch') as any;
    expect(batch).toMatchObject({
      assistantMessageId: 'msg_2',
      content: 'thinking',
      threadId: 'thd_1',
    });
    expect(batch.tools).toHaveLength(2);
    expect(batch.tools[0]).toMatchObject({
      isNew: true,
      toolMessageId: 'msg_3',
      payload: { id: 'tc-1' },
    });
    expect(batch.tools[1]).toMatchObject({
      isNew: true,
      toolMessageId: 'msg_4',
      payload: { id: 'tc-2' },
    });

    // next assistant chains off the LAST tool message of the batch
    expect(state.runs.get('task-1')!.lastChainParentId).toBe('msg_4');
    expect([...state.runs.get('task-1')!.lifetimeToolCallIds]).toEqual(['tc-1', 'tc-2']);
  });

  it('de-dupes already-persisted tools in the same turn (isNew false, no new id)', () => {
    const { steps } = run([
      toolsEvent('task-1', 'm1', [tool('tc-1')]),
      toolsEvent('task-1', 'm1', [tool('tc-1'), tool('tc-2')]),
    ]);
    const batch2 = steps[1].find((i) => i.kind === 'persistToolBatch') as any;
    expect(batch2.tools.map((t: any) => [t.payload.id, t.isNew, t.toolMessageId])).toEqual([
      ['tc-1', false, 'msg_3'], // reused id from first batch
      ['tc-2', true, 'msg_4'],
    ]);
  });

  it('cuts a new turn on subagentMessageId change: flush prior + new assistant chained off last tool', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'first turn text'),
      toolsEvent('task-1', 'm1', [tool('tc-1')]), // lastChainParentId → msg_3
      textEvent('task-1', 'm2', 'second turn'), // turn boundary
    ]);

    // boundary flushes prior turn content, opens a new assistant off the last tool msg (msg_3)
    expect(kinds(steps[2])).toEqual(['persistContent', 'createMessage', 'streamContent']);
    expect(steps[2][0]).toMatchObject({ content: 'first turn text', messageId: 'msg_2' });
    expect(steps[2][1]).toMatchObject({ messageId: 'msg_4', parentId: 'msg_3', role: 'assistant' });
    expect(steps[2][2]).toMatchObject({ content: 'second turn', messageId: 'msg_4' });

    const r = state.runs.get('task-1')!;
    expect(r.currentAssistantId).toBe('msg_4');
    expect(r.currentSubagentMessageId).toBe('m2');
    expect(r.accContent).toBe('second turn');
    expect(r.toolState.persistedIds.size).toBe(0); // per-turn reset
  });

  it('resolves an inner tool_result into its owning run', () => {
    const { steps } = run([
      toolsEvent('task-1', 'm1', [tool('tc-1')]),
      { data: { content: 'ls output', isError: false, toolCallId: 'tc-1' }, type: 'tool_result' },
    ]);
    expect(steps[1]).toEqual([
      {
        content: 'ls output',
        isError: false,
        kind: 'resolveToolResult',
        pluginState: undefined,
        threadId: 'thd_1',
        toolCallId: 'tc-1',
      },
    ]);
  });

  it('finalizes on the parent tool_result: flush + terminal assistant + finalizeThread + deletes run', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'trailing summary'),
      { data: { content: 'subagent answer', toolCallId: 'task-1' }, type: 'tool_result' },
    ]);

    expect(kinds(steps[1])).toEqual(['persistContent', 'createMessage', 'finalizeThread']);
    expect(steps[1][0]).toMatchObject({ content: 'trailing summary', messageId: 'msg_2' });
    expect(steps[1][1]).toMatchObject({
      content: 'subagent answer',
      parentId: 'msg_2',
      role: 'assistant',
      messageId: 'msg_3',
    });
    expect(steps[1][2]).toMatchObject({ threadId: 'thd_1' });
    expect(state.runs.has('task-1')).toBe(false); // deleted
  });

  it('records subagent usage onto the current assistant', () => {
    const usage = { totalTokens: 42 };
    const { steps } = run([
      textEvent('task-1', 'm1', 'x'),
      {
        data: {
          model: 'claude',
          phase: 'turn_metadata',
          provider: 'claude-code',
          subagent: sub('task-1', 'm1'),
          usage,
        },
        type: 'step_complete',
      },
    ]);
    expect(steps[1]).toEqual([
      {
        kind: 'recordUsage',
        messageId: 'msg_2',
        model: 'claude',
        provider: 'claude-code',
        threadId: 'thd_1',
        usage,
      },
    ]);
  });

  it('drains orphan runs on agent_runtime_end (flush only, no terminal assistant)', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'orphan content'),
      { data: { reason: 'success' }, type: 'agent_runtime_end' },
    ]);
    expect(kinds(steps[1])).toEqual(['persistContent', 'finalizeThread']);
    expect(steps[1][0]).toMatchObject({ content: 'orphan content', messageId: 'msg_2' });
    expect(state.runs.size).toBe(0);
  });

  it('drains multiple orphan runs independently', () => {
    const { steps } = run([
      toolsEvent('task-1', 'm1', [tool('a')]),
      toolsEvent('task-2', 'n1', [tool('b')]),
      { data: {}, type: 'error' },
    ]);
    // two runs → two finalizeThread intents
    expect(steps[2].filter((i) => i.kind === 'finalizeThread')).toHaveLength(2);
  });

  it('ignores main-scoped events and unowned tool_results (no intents, state unchanged)', () => {
    const state0 = createSubagentRunsState();
    const main = reduceSubagentRuns(
      state0,
      { data: { chunkType: 'text', content: 'hi' }, type: 'stream_chunk' },
      makeCtx(),
    );
    expect(main.intents).toEqual([]);
    expect(main.state).toBe(state0);

    const orphanResult = reduceSubagentRuns(
      state0,
      { data: { content: 'x', toolCallId: 'unknown' }, type: 'tool_result' },
      makeCtx(),
    );
    expect(orphanResult.intents).toEqual([]);
  });

  it('is transactional: reduce does not mutate the input state', () => {
    const state0 = createSubagentRunsState();
    const r1 = reduceSubagentRuns(state0, textEvent('task-1', 'm1', 'a'), makeCtx());
    // input untouched
    expect(state0.runs.size).toBe(0);
    expect(r1.state.runs.size).toBe(1);

    // mutating the next state's run must not bleed into a re-reduce of the old state
    const r2 = reduceSubagentRuns(r1.state, toolsEvent('task-1', 'm1', [tool('tc-1')]), makeCtx());
    expect(r1.state.runs.get('task-1')!.toolState.persistedIds.size).toBe(0);
    expect(r2.state.runs.get('task-1')!.toolState.persistedIds.size).toBe(1);
  });
});
