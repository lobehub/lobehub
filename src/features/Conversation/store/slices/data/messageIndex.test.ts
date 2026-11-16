import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createStore } from '../../index';
import type { State } from '../../initialState';
import { findBlockInDisplayMessages, indexDbMessages } from './messageIndex';
import { dataSelectors } from './selectors';

const msgs = (rows: unknown[]) => rows as UIChatMessage[];
const stateOf = (displayMessages: unknown[], dbMessages: unknown[] = []) =>
  ({ dbMessages, displayMessages }) as unknown as State;

/** An array that counts how many times it is walked (iteration or `find`). */
const countedArray = <T>(items: T[]) => {
  const counter = { walks: 0 };
  const array = [...items];
  const iterate = array[Symbol.iterator].bind(array);
  const find = array.find.bind(array);
  Object.defineProperty(array, Symbol.iterator, {
    value: () => {
      counter.walks += 1;
      return iterate();
    },
  });
  Object.defineProperty(array, 'find', {
    value: (...args: Parameters<typeof find>) => {
      counter.walks += 1;
      return find(...args);
    },
  });
  return { array, counter };
};

describe('findBlockInDisplayMessages', () => {
  it('resolves blocks from standalone rows, groups, compressed groups and council members', () => {
    const messages = msgs([
      { content: 'solo', id: 'a1', role: 'assistant', tools: [{ id: 'c1' }] },
      { children: [{ content: 'child', id: 'b1' }], id: 'g1', role: 'assistantGroup' },
      {
        compressedMessages: [
          { children: [{ content: 'folded', id: 'b2' }], id: 'g2', role: 'assistantGroup' },
        ],
        id: 'cg',
        role: 'compressedGroup',
      },
      {
        id: 'council',
        members: [{ content: 'member', id: 'm1', role: 'assistant' }],
        role: 'agentCouncil',
      },
    ]);

    expect(findBlockInDisplayMessages(messages, 'a1')).toMatchObject({
      content: 'solo',
      tools: [{ id: 'c1' }],
    });
    expect(findBlockInDisplayMessages(messages, 'b1')?.content).toBe('child');
    expect(findBlockInDisplayMessages(messages, 'b2')?.content).toBe('folded');
    expect(findBlockInDisplayMessages(messages, 'm1')?.content).toBe('member');
    expect(findBlockInDisplayMessages(messages, 'missing')).toBeUndefined();
  });

  it('keeps the first match in walk order when an id repeats', () => {
    const messages = msgs([
      { children: [{ content: 'first', id: 'dup' }], id: 'g1', role: 'assistantGroup' },
      { children: [{ content: 'second', id: 'dup' }], id: 'g2', role: 'assistantGroup' },
    ]);

    expect(findBlockInDisplayMessages(messages, 'dup')?.content).toBe('first');
  });

  it('returns the same block object for an unchanged standalone row in a new snapshot', () => {
    const row = { content: 'solo', id: 'a1', role: 'assistant', tools: [{ id: 'c1' }] };
    const before = findBlockInDisplayMessages(msgs([row]), 'a1');
    const after = findBlockInDisplayMessages(msgs([{ id: 'u1', role: 'user' }, row]), 'a1');

    expect(after).toBe(before);
  });

  /** @example A long turn re-ran this walk for every row on every chunk. */
  it('walks a snapshot once no matter how many rows look blocks up', () => {
    const { array: children, counter } = countedArray(
      Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, tools: [{ id: `c${i}` }] })),
    );
    const state = stateOf([{ children, id: 'g1', role: 'assistantGroup' }]);

    for (let i = 0; i < 50; i++) {
      expect(dataSelectors.getToolInBlock(`b${i}`, `c${i}`)(state)?.id).toBe(`c${i}`);
    }

    expect(counter.walks).toBe(1);
  });
});

describe('indexDbMessages', () => {
  it('looks rows up by id and by tool call id, first row wins', () => {
    const rows = msgs([
      { id: 'm1', role: 'user' },
      { id: 't1', role: 'tool', tool_call_id: 'call_1' },
      { id: 't2', role: 'tool', tool_call_id: 'call_1' },
    ]);
    const state = stateOf([], rows);

    expect(dataSelectors.getDbMessageById('t2')(state)?.id).toBe('t2');
    expect(dataSelectors.getDbMessageByToolCallId('call_1')(state)?.id).toBe('t1');
    expect(dataSelectors.getDbMessageById('missing')(state)).toBeUndefined();
  });

  it('builds the index once per rows snapshot', () => {
    const rows = msgs([{ id: 'm1', role: 'user' }]);

    expect(indexDbMessages(rows)).toBe(indexDbMessages(rows));
    expect(indexDbMessages([...rows])).not.toBe(indexDbMessages(rows));
  });
});

describe('tool identity across streaming chunks', () => {
  const transcript = msgs([
    { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
    {
      content: '',
      createdAt: 1,
      id: 'a1',
      parentId: 'u1',
      role: 'assistant',
      tools: [{ apiName: 'run', arguments: '{}', id: 'call_1', identifier: 'x', type: 'default' }],
      updatedAt: 1,
    },
    {
      content: 'done',
      createdAt: 2,
      id: 't1',
      parentId: 'a1',
      role: 'tool',
      tool_call_id: 'call_1',
      updatedAt: 2,
    },
    { content: 'stream', createdAt: 3, id: 'a2', parentId: 't1', role: 'assistant', updatedAt: 3 },
  ]);

  /** @example Rows subscribe with `Object.is`, so an untouched tool must keep its object. */
  it('keeps an untouched tool reference when another step streams', () => {
    const store = createStore({
      context: { agentId: 'agent', threadId: null, topicId: 'topic' },
      messages: transcript,
    });
    const before = dataSelectors.getToolInBlock('a1', 'call_1')(store.getState());

    store.getState().internal_dispatchMessage({
      id: 'a2',
      type: 'updateMessage',
      value: { content: 'stream more' },
    });

    expect(dataSelectors.getBlockContent('a2')(store.getState())).toBe('stream more');
    expect(dataSelectors.getToolInBlock('a1', 'call_1')(store.getState())).toBe(before);
  });
});
