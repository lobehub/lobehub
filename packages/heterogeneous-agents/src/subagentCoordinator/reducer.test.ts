import { describe, expect, it } from 'vitest';

import { createSubagentRunsState, reduceSubagentRuns, rehydrateSubagentRunsState } from './index';
import type { PersistToolBatchIntent, SubagentIntent, SubagentReduceCtx } from './types';

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

const toolStateEvent = (
  parentToolCallId: string,
  subagentMessageId: string,
  toolCallId: string,
  snapshotSeq: number,
) => ({
  data: {
    chunkType: 'tool_state',
    pluginState: { progress: snapshotSeq },
    snapshotMode: 'replace',
    snapshotSeq,
    subagent: sub(parentToolCallId, subagentMessageId),
    toolCallId,
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

    // Chain rule (phase 2): the next assistant chains off the prior assistant
    // (the spine), NOT the batch's last tool — so lastChainParentId stays at the
    // current assistant (msg_2) and the tools are inline children.
    expect(state.runs.get('task-1')!.lastChainParentId).toBe('msg_2');
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

  it('cuts a new turn on subagentMessageId change: flush prior + new assistant chained off the prior assistant', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'first turn text'),
      toolsEvent('task-1', 'm1', [tool('tc-1')]), // tool is an inline child of msg_2
      textEvent('task-1', 'm2', 'second turn'), // turn boundary
    ]);

    // boundary flushes prior turn content, opens a new assistant off the prior
    // assistant (the spine, msg_2) — NOT the last tool — with the tool inline
    expect(kinds(steps[2])).toEqual(['persistContent', 'createMessage', 'streamContent']);
    expect(steps[2][0]).toMatchObject({ content: 'first turn text', messageId: 'msg_2' });
    expect(steps[2][1]).toMatchObject({ messageId: 'msg_4', parentId: 'msg_2', role: 'assistant' });
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

  it('routes tool-state snapshots to the owning subagent thread', () => {
    const { steps } = run([
      toolsEvent('task-1', 'm1', [tool('tc-1')]),
      toolStateEvent('task-1', 'm1', 'tc-1', 3),
    ]);

    expect(steps[1]).toEqual([
      {
        kind: 'updateToolState',
        pluginState: { progress: 3 },
        snapshotSeq: 3,
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

  it('does NOT re-create the thread when a finalized spawn replays its first event', () => {
    // Finalize via the parent tool_result, then replay the SAME first chunk a
    // cold-replica retry / double IPC delivery would resend. `ensureRun` must
    // treat the already-finalized parent as a stale no-op — no second thread.
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'working', { description: 'Map client runtime' }),
      { data: { content: 'answer', toolCallId: 'task-1' }, type: 'tool_result' }, // finalize
      // ↓ exact replay of the very first subagent chunk for task-1
      textEvent('task-1', 'm1', 'working', { description: 'Map client runtime' }),
    ]);

    // The replay produces NO intents (no createThread, no createMessage).
    expect(steps[2]).toEqual([]);
    // Run stays deleted; the parent is remembered as finalized.
    expect(state.runs.has('task-1')).toBe(false);
    expect(state.finalizedParents.has('task-1')).toBe(true);
  });

  it('reopens a finalized thread when the subagent resumes with a NEW turn', () => {
    // CC `SendMessage` resumes a completed subagent; its events keep the
    // original `parent_tool_use_id`. The new turn must continue the existing
    // thread from its tail, not be dropped as a stale replay.
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'working'),
      toolsEvent('task-1', 'm1', [tool('tc-1')]),
      { data: { content: 'answer', toolCallId: 'task-1' }, type: 'tool_result' }, // finalize
      toolsEvent('task-1', 'm2', [tool('tc-2')]),
    ]);

    // seed msg_1, assistant msg_2, tool msg_3, hand-back msg_4
    expect(kinds(steps[3])).toEqual(['reopenThread', 'createMessage', 'persistToolBatch']);
    expect(steps[3][0]).toMatchObject({ threadId: 'thd_1' });
    expect(steps[3][1]).toMatchObject({
      messageId: 'msg_5',
      parentId: 'msg_4',
      role: 'assistant',
      subagentMessageId: 'm2',
      threadId: 'thd_1',
    });
    expect(state.runs.get('task-1')).toMatchObject({
      currentAssistantId: 'msg_5',
      currentSubagentMessageId: 'm2',
      threadId: 'thd_1',
    });
    expect(state.finalizedParents.has('task-1')).toBe(false);
  });

  it('keeps dropping a replay of a turn the finalized thread already holds', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'working'),
      toolsEvent('task-1', 'm2', [tool('tc-1')]),
      { data: { content: 'answer', toolCallId: 'task-1' }, type: 'tool_result' }, // finalize
      // ↓ replays of both earlier turns
      textEvent('task-1', 'm1', 'working'),
      toolsEvent('task-1', 'm2', [tool('tc-1')]),
    ]);

    expect(steps[3]).toEqual([]);
    expect(steps[4]).toEqual([]);
    expect(state.runs.has('task-1')).toBe(false);
    expect(state.finalizedParents.has('task-1')).toBe(true);
  });

  it('re-finalizes a resumed run and remembers its resumed turns', () => {
    const { steps, state } = run([
      textEvent('task-1', 'm1', 'working'),
      { data: { content: 'answer', toolCallId: 'task-1' }, type: 'tool_result' }, // finalize
      textEvent('task-1', 'm2', 'resumed'),
      { data: {}, type: 'agent_runtime_end' }, // orphan drain closes the resumed run
      textEvent('task-1', 'm2', 'resumed'), // replay of the resumed turn
      textEvent('task-1', 'm3', 'resumed again'),
    ]);

    expect(kinds(steps[3])).toEqual(['persistContent', 'finalizeThread']);
    expect(steps[4]).toEqual([]);
    // m3 chains off the resumed turn's assistant (msg_4), not the first hand-back.
    expect(kinds(steps[5])).toEqual(['reopenThread', 'createMessage', 'streamContent']);
    expect(steps[5][1]).toMatchObject({ messageId: 'msg_5', parentId: 'msg_4' });
    expect(state.runs.get('task-1')!.currentSubagentMessageId).toBe('m3');
  });

  it('resumes from a rehydrated finalized anchor (cold replica)', () => {
    const state0 = rehydrateSubagentRunsState(
      [],
      ['task-1'],
      [
        {
          lastChainParentId: 'asst-tail',
          lifetimeToolCallIds: ['tc-1'],
          parentToolCallId: 'task-1',
          threadId: 'thd-x',
          turnIds: ['m1'],
        },
      ],
    );

    const replay = reduceSubagentRuns(
      state0,
      toolsEvent('task-1', 'm1', [tool('tc-1')]),
      makeCtx(),
    );
    expect(replay.intents).toEqual([]);

    const resumed = reduceSubagentRuns(
      state0,
      toolsEvent('task-1', 'm2', [tool('tc-1'), tool('tc-2')]),
      makeCtx(),
    );
    expect(kinds(resumed.intents)).toEqual(['reopenThread', 'createMessage', 'persistToolBatch']);
    expect(resumed.intents[1]).toMatchObject({ parentId: 'asst-tail', threadId: 'thd-x' });
    // tc-1 already lives in the thread — only tc-2 becomes a new tool row.
    const batch = resumed.intents[2] as PersistToolBatchIntent;
    expect(batch.tools.map((t) => t.payload.id)).toEqual(['tc-2']);
  });

  it('continues a rehydrated in-flight turn with its persisted text and tools', () => {
    // A replica that rebuilds the run from DB mid-turn must keep the turn's
    // earlier text and tools; otherwise the next write replaces them.
    const state0 = rehydrateSubagentRunsState([
      {
        accContent: 'first half ',
        currentAssistantId: 'asst-1',
        currentSubagentMessageId: 'm1',
        lifetimeToolCallIds: ['tc-1'],
        parentToolCallId: 'task-1',
        threadId: 'thd-x',
        turnTools: [{ payload: tool('tc-1'), toolMessageId: 'tool-msg-1' }],
      },
    ]);

    const text = reduceSubagentRuns(state0, textEvent('task-1', 'm1', 'second half'), makeCtx());
    expect(text.intents).toEqual([
      {
        content: 'first half second half',
        kind: 'streamContent',
        messageId: 'asst-1',
        threadId: 'thd-x',
      },
    ]);

    const tools = reduceSubagentRuns(
      text.state,
      toolsEvent('task-1', 'm1', [tool('tc-1'), tool('tc-2')]),
      makeCtx(),
    );
    const batch = tools.intents[0] as PersistToolBatchIntent;
    expect(batch.content).toBe('first half second half');
    expect(batch.tools.map((t) => [t.payload.id, t.isNew, t.toolMessageId])).toEqual([
      ['tc-1', false, 'tool-msg-1'],
      ['tc-2', true, 'msg_1'],
    ]);
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
        // Carried so recordUsage's wholesale metadata overwrite re-stamps
        // heteroMessageId instead of wiping it.
        subagentMessageId: 'm1',
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
