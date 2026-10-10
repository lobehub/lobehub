import { describe, expect, it } from 'vitest';

import { parse } from '../parse';
import type { Message } from '../types/shared';

/**
 * Regression tests for string `createdAt` payloads (LOBE-14005 / T-614).
 *
 * The Gateway snapshot serializes timestamps as ISO strings while the static
 * contract says `number`. Every ordering site used arithmetic comparison, so a
 * string payload produced `NaN` comparators: `sort` kept traversal order and
 * the renderer showed out-of-order messages with stale bubbles pinned at the
 * bottom of the list. All ordering sites now coerce through `toTime`.
 */
const iso = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 9, 10, 12, 0, 0) - minutesAgo * 60_000).toISOString();

const base = (overrides: Partial<Message> & { id: string }): Message =>
  ({
    content: '',
    createdAt: Date.now(),
    role: 'user',
    ...overrides,
  }) as Message;

describe('string createdAt payloads (LOBE-14005)', () => {
  it('orders a linear conversation chronologically when createdAt is ISO strings', () => {
    const messages: Message[] = [
      base({ id: 'msg-old', createdAt: iso(30), role: 'user', content: 'first' }),
      base({
        id: 'msg-a-old',
        createdAt: iso(20),
        role: 'assistant',
        content: 'reply-old',
        parentId: 'msg-old',
      }),
      base({
        id: 'msg-new',
        createdAt: iso(10),
        role: 'user',
        content: 'second',
        parentId: 'msg-a-old',
      }),
      base({
        id: 'msg-a-new',
        createdAt: iso(5),
        role: 'assistant',
        content: 'reply-new',
        parentId: 'msg-new',
      }),
    ];

    const { flatList } = parse(messages);
    expect(flatList.map((m) => m.id)).toEqual(['msg-old', 'msg-a-old', 'msg-new', 'msg-a-new']);
  });

  it('restores chronology when parallel tool continuations under different agents are appended out of order', () => {
    // A fan-out turn with two tool results; each result continues under a
    // different agent (so neither continuation is suppressed as an inactive
    // branch). The DFS walk reaches tool-1's newer continuation before
    // tool-2's older one; the final flatList.sort must restore the persisted
    // chronology. With a string payload the numeric comparator used to be
    // NaN and the stale continuation stayed pinned after the newer one.
    const messages: Message[] = [
      base({ id: 'root', createdAt: iso(40), role: 'user', content: 'go' }),
      {
        ...base({
          id: 'a1',
          createdAt: iso(35),
          role: 'assistant',
          content: 'fan out',
          parentId: 'root',
        }),
        tools: [
          { id: 'tool-1', type: 'default', apiName: 'x', identifier: 'p', arguments: '{}' },
          { id: 'tool-2', type: 'default', apiName: 'y', identifier: 'p', arguments: '{}' },
        ],
      },
      base({ id: 'tool-1', createdAt: iso(34), role: 'tool', parentId: 'a1', tool_call_id: 'tool-1' }),
      base({ id: 'tool-2', createdAt: iso(33), role: 'tool', parentId: 'a1', tool_call_id: 'tool-2' }),
      base({
        id: 'cont-new',
        createdAt: iso(25),
        role: 'assistant',
        content: 'newer continuation (tool-1)',
        parentId: 'tool-1',
        agentId: 'agent-a',
      }),
      base({
        id: 'cont-old',
        createdAt: iso(30),
        role: 'assistant',
        content: 'older continuation (tool-2)',
        parentId: 'tool-2',
        agentId: 'agent-b',
      }),
    ];

    const { flatList } = parse(messages);
    const order = flatList.map((m) => m.id);
    expect(order).toContain('cont-old');
    expect(order).toContain('cont-new');
    // persisted chronology: older continuation renders first
    expect(order.indexOf('cont-old')).toBeLessThan(order.indexOf('cont-new'));
  });

  it('does not regress numeric createdAt conversations', () => {
    const t0 = Date.UTC(2026, 9, 10, 12, 0, 0);
    const messages: Message[] = [
      base({ id: 'm1', createdAt: t0 - 30_000, role: 'user', content: 'a' }),
      base({ id: 'm2', createdAt: t0 - 20_000, role: 'assistant', content: 'b', parentId: 'm1' }),
      base({ id: 'm3', createdAt: t0 - 10_000, role: 'user', content: 'c', parentId: 'm2' }),
    ];

    const { flatList } = parse(messages);
    expect(flatList.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
