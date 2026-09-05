import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  collectPreservedMessageIds,
  DEFAULT_TAIL_PRESERVE_RATIO,
  getTailPreserveBudget,
  MAX_TAIL_PRESERVE_TOKENS,
  selectPreservedTail,
} from './preserveTail';

const mkMsg = (id: string, role: UIChatMessage['role'], content = ''): UIChatMessage =>
  ({ content, createdAt: 0, id, role, updatedAt: 0 }) as UIChatMessage;

/** ~1 token per 4 chars of ASCII under tokenx. */
const filler = (tokens: number) => 'a '.repeat(tokens * 2);

describe('getTailPreserveBudget', () => {
  it('should take a fraction of the threshold', () => {
    expect(getTailPreserveBudget(100_000)).toBe(100_000 * DEFAULT_TAIL_PRESERVE_RATIO);
  });

  it('should cap the tail so huge windows do not carry raw history forever', () => {
    // 1M window -> 1.015M threshold -> 203k at the raw ratio, capped to 32k
    expect(getTailPreserveBudget(1_015_576)).toBe(MAX_TAIL_PRESERVE_TOKENS);
  });

  it('should accept a ratio override', () => {
    expect(getTailPreserveBudget(100_000, 0.1)).toBe(10_000);
  });
});

describe('selectPreservedTail', () => {
  it('should return nothing when there is at most one message', () => {
    expect(selectPreservedTail([], 10_000)).toEqual([]);
    expect(selectPreservedTail([mkMsg('a', 'user')], 10_000)).toEqual([]);
  });

  // Guards the pre-change contract for callers that do not pass a budget.
  it('should fall back to the trailing user message with no budget', () => {
    const messages = [mkMsg('a', 'user'), mkMsg('b', 'assistant'), mkMsg('c', 'user')];

    expect(selectPreservedTail(messages, 0).map((m) => m.id)).toEqual(['c']);
  });

  it('should preserve nothing with no budget when the tail is not a user message', () => {
    const messages = [mkMsg('a', 'user'), mkMsg('b', 'assistant')];

    expect(selectPreservedTail(messages, 0)).toEqual([]);
  });

  it('should keep the longest suffix that fits the budget', () => {
    const messages = [
      mkMsg('a', 'user', filler(5_000)),
      mkMsg('b', 'assistant', filler(5_000)),
      mkMsg('c', 'user', filler(400)),
      mkMsg('d', 'assistant', filler(400)),
    ];

    // 800 tokens of tail fits a 2k budget; adding 'b' (5k) would not.
    expect(selectPreservedTail(messages, 2_000).map((m) => m.id)).toEqual(['c', 'd']);
  });

  // Without this the model loses the tool results it is mid-way through using,
  // which is what sends it back to re-reading the same files after a compaction.
  it('should keep a whole trailing tool round rather than only the last message', () => {
    const messages = [
      mkMsg('old', 'user', filler(5_000)),
      mkMsg('a1', 'assistant', filler(100)),
      mkMsg('t1', 'tool', filler(100)),
      mkMsg('a2', 'assistant', filler(100)),
    ];

    expect(selectPreservedTail(messages, 2_000).map((m) => m.id)).toEqual(['a1', 't1', 'a2']);
  });

  // A `tool` message whose assistant tool_calls were summarized away is an
  // orphaned pairing that most providers reject outright.
  it('should never start the preserved segment on a tool message', () => {
    const messages = [
      mkMsg('u', 'user', filler(5_000)),
      mkMsg('a1', 'assistant', filler(5_000)),
      mkMsg('t1', 'tool', filler(100)),
      mkMsg('t2', 'tool', filler(100)),
      mkMsg('a2', 'assistant', filler(100)),
    ];

    // Budget fits t1/t2/a2 but not a1 — the orphaned results must be dropped.
    const tail = selectPreservedTail(messages, 1_000);

    expect(tail.map((m) => m.id)).toEqual(['a2']);
    expect(tail[0]?.role).not.toBe('tool');
  });

  it('should always leave at least one message to compress', () => {
    const messages = [mkMsg('a', 'user', 'hi'), mkMsg('b', 'assistant', 'yo')];

    const tail = selectPreservedTail(messages, 1_000_000);

    expect(tail.map((m) => m.id)).toEqual(['b']);
    expect(tail.length).toBeLessThan(messages.length);
  });

  // The message that triggered this turn must survive even when it alone is
  // bigger than the whole tail budget.
  it('should keep an oversized trailing user message anyway', () => {
    const messages = [
      mkMsg('a', 'user', filler(100)),
      mkMsg('b', 'assistant', filler(100)),
      mkMsg('c', 'user', filler(50_000)),
    ];

    expect(selectPreservedTail(messages, 1_000).map((m) => m.id)).toEqual(['c']);
  });

  it('should return a contiguous suffix of the input', () => {
    const messages = [
      mkMsg('a', 'user', filler(5_000)),
      mkMsg('b', 'assistant', filler(200)),
      mkMsg('c', 'user', filler(200)),
    ];

    const tail = selectPreservedTail(messages, 2_000);

    expect(messages.slice(messages.length - tail.length)).toEqual(tail);
  });
});

describe('collectPreservedMessageIds', () => {
  it('should collect plain message ids', () => {
    const ids = collectPreservedMessageIds([mkMsg('a', 'user'), mkMsg('b', 'assistant')]);

    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  // The compression executor filters raw DB rows, but the server hands it a
  // conversation-flow projection where a whole tool chain is one wrapper whose
  // id is only its first assistant.
  it('should expand folded assistantGroup children and their tool rows', () => {
    const folded = {
      children: [
        { content: '', id: 'msg-a1', tools: [{ id: 'call-1', result_msg_id: 'msg-t1' }] },
        { content: '', id: 'msg-a2', tools: [{ id: 'call-2', result_msg_id: 'msg-t2' }] },
      ],
      content: '',
      id: 'msg-a1',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    const ids = collectPreservedMessageIds([folded]);

    expect([...ids].sort()).toEqual(['msg-a1', 'msg-a2', 'msg-t1', 'msg-t2']);
  });

  it('should expand supervisor, agentCouncil, tasks and compare containers', () => {
    const messages = [
      { children: [{ id: 'sup-child' }], id: 'sup', role: 'supervisor' },
      { id: 'council-wrapper', members: [{ id: 'member-1' }], role: 'agentCouncil' },
      { id: 'tasks-wrapper', role: 'tasks', tasks: [{ id: 'task-1' }] },
      { columns: [[{ id: 'col-1' }], [{ id: 'col-2' }]], id: 'cmp', role: 'compare' },
    ] as unknown as UIChatMessage[];

    const ids = collectPreservedMessageIds(messages);

    for (const id of ['sup-child', 'member-1', 'task-1', 'col-1', 'col-2']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('should recurse into an in-bubble council block', () => {
    const folded = {
      children: [{ council: [{ id: 'broadcast-member' }], id: 'council-msg-a1' }],
      id: 'msg-a1',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    expect(collectPreservedMessageIds([folded]).has('broadcast-member')).toBe(true);
  });

  it('should tolerate missing ids and non-array children', () => {
    const messages = [
      { children: undefined, role: 'assistantGroup' },
      { id: '', role: 'user' },
      { id: 'real', role: 'user', tools: [{ id: 'call-x' }] },
    ] as unknown as UIChatMessage[];

    expect([...collectPreservedMessageIds(messages)]).toEqual(['real']);
  });
});
