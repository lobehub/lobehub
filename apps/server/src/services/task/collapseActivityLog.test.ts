import { describe, expect, it } from 'vitest';

import { collapseActivityLog } from './collapseActivityLog';

const t = (minutes: number) => new Date(Date.UTC(2024, 0, 1, 0, minutes));
const row = (
  id: string,
  minutes: number,
  payload: Record<string, unknown>,
  actorUserId = 'user_a',
  type: 'priority' | 'status' | 'assignee_agent' = 'priority',
) => ({ actorAgentId: null, actorUserId, createdAt: t(minutes), id, payload, type }) as any;

describe('collapseActivityLog', () => {
  it('folds a burst of edits into one entry from the first value to the last', () => {
    const out = collapseActivityLog([
      row('a', 0, { from: 3, to: 2 }),
      row('b', 1, { from: 2, to: 1 }),
      row('c', 2, { from: 1, to: 4 }),
    ]);
    expect(out).toHaveLength(1);
    // Newest id and time — the feed asks "when did it settle".
    expect(out[0]).toMatchObject({ id: 'c', payload: { from: 3, to: 4 } });
  });

  it('shows nothing when the value ends up where it started', () => {
    const out = collapseActivityLog([
      row('a', 0, { from: 2, to: 4 }),
      row('b', 1, { from: 4, to: 2 }),
    ]);
    expect(out).toEqual([]);
  });

  it('applies the same net-noop rule to assignee ids', () => {
    const out = collapseActivityLog([
      row('a', 0, { fromId: 'agt_1', toId: 'agt_2' }, 'user_a', 'assignee_agent'),
      row('b', 1, { fromId: 'agt_2', toId: 'agt_1' }, 'user_a', 'assignee_agent'),
    ]);
    expect(out).toEqual([]);
  });

  it('starts a new entry once the window has lapsed', () => {
    const out = collapseActivityLog(
      [row('a', 0, { from: 3, to: 2 }), row('b', 60, { from: 2, to: 3 })],
      30 * 60_000,
    );
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('slides the window from the last hop, not the first', () => {
    // Each hop is 20 min apart; the run lives on as long as no single gap
    // exceeds the window, even though first→last spans more than it.
    const out = collapseActivityLog(
      [
        row('a', 0, { from: 3, to: 2 }),
        row('b', 20, { from: 2, to: 1 }),
        row('c', 40, { from: 1, to: 4 }),
      ],
      30 * 60_000,
    );
    expect(out).toHaveLength(1);
    expect(out[0].payload).toMatchObject({ from: 3, to: 4 });
  });

  it('never merges two people: A moving it and B moving it back are two decisions', () => {
    const out = collapseActivityLog([
      row('a', 0, { from: 2, to: 4 }, 'user_a'),
      row('b', 1, { from: 4, to: 2 }, 'user_b'),
    ]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('breaks a run when someone else moved the value in between', () => {
    // A 2→4, B 4→3, A 3→2: without the continuity check A's two hops would
    // fold into a hidden no-op and leave only B's 4→3 on screen.
    const out = collapseActivityLog([
      row('a', 0, { from: 2, to: 4 }),
      row('b', 1, { from: 4, to: 3 }, 'user_b'),
      row('c', 2, { from: 3, to: 2 }),
    ]);
    expect(out.map((r) => [r.id, r.payload.from, r.payload.to])).toEqual([
      ['a', 2, 4],
      ['b', 4, 3],
      ['c', 3, 2],
    ]);
  });

  it('ends a run when someone else moves the property, even if they move it back', () => {
    // A 2→4, B 4→3→4, A 4→2: continuity alone would let A's run survive B's
    // round trip and fold everything into nothing.
    const out = collapseActivityLog([
      row('a', 0, { from: 2, to: 4 }),
      row('b', 1, { from: 4, to: 3 }, 'user_b'),
      row('c', 2, { from: 3, to: 4 }, 'user_b'),
      row('d', 3, { from: 4, to: 2 }),
    ]);
    expect(out.map((r) => [r.id, r.payload.from, r.payload.to])).toEqual([
      ['a', 2, 4],
      ['d', 4, 2],
    ]);
  });

  it('applies the continuity rule to assignee ids too', () => {
    const out = collapseActivityLog([
      row('a', 0, { fromId: 'x', toId: 'y' }, 'user_a', 'assignee_agent'),
      row('b', 1, { fromId: 'y', toId: 'z' }, 'user_b', 'assignee_agent'),
      row('c', 2, { fromId: 'z', toId: 'x' }, 'user_a', 'assignee_agent'),
    ]);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps different properties apart even for the same person', () => {
    const out = collapseActivityLog([
      row('a', 0, { from: 3, to: 1 }, 'user_a', 'priority'),
      row('b', 1, { from: 'backlog', to: 'completed' }, 'user_a', 'status'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('compares automation snapshots by value when deciding a net noop', () => {
    const on = {
      heartbeatInterval: null,
      mode: 'schedule',
      schedulePattern: '0 9 * * *',
      scheduleTimezone: 'UTC',
    };
    const out = collapseActivityLog([
      row('a', 0, { from: null, to: on }, 'user_a', 'status'),
      row('b', 1, { from: on, to: null }, 'user_a', 'status'),
    ]);
    expect(out).toEqual([]);
  });
});
