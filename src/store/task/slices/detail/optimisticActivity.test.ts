import { describe, expect, it } from 'vitest';

import {
  appendOptimisticPropertyActivity,
  buildOptimisticAssignmentActivities,
  buildOptimisticCommentActivity,
  buildOptimisticPropertyActivity,
  isOptimisticActivityId,
  OPTIMISTIC_ACTIVITY_ID_PREFIX,
} from './optimisticActivity';

const actor = { avatar: null, id: 'user_me', name: 'Me', type: 'user' as const };
const now = '2024-01-01T00:00:00.000Z';

describe('buildOptimisticAssignmentActivities', () => {
  it('synthesizes an assignment row with the picker-supplied target', () => {
    const rows = buildOptimisticAssignmentActivities({
      actor,
      assigneeAgentId: 'agt_1',
      current: { agentId: null, userId: null },
      now,
      target: { avatar: 'a.png', id: 'agt_1', name: 'Rika', type: 'agent' },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assignment: { from: null, kind: 'agent', to: { id: 'agt_1', name: 'Rika' } },
      author: actor,
      time: now,
      type: 'assignment',
    });
    expect(rows[0].id?.startsWith(OPTIMISTIC_ACTIVITY_ID_PREFIX)).toBe(true);
  });

  it('reads as a removal when the slot is cleared', () => {
    const rows = buildOptimisticAssignmentActivities({
      actor,
      assigneeUserId: null,
      current: { agentId: null, userId: 'user_bob' },
      now,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].assignment).toEqual({
      from: { id: 'user_bob', name: null, type: 'user' },
      kind: 'member',
      to: null,
    });
  });

  it('mirrors the server: a re-saved identical assignee produces no row', () => {
    expect(
      buildOptimisticAssignmentActivities({
        actor,
        assigneeAgentId: 'agt_1',
        current: { agentId: 'agt_1', userId: null },
        now,
      }),
    ).toEqual([]);
  });

  it('leaves an untouched slot alone and logs both when both move', () => {
    const rows = buildOptimisticAssignmentActivities({
      actor,
      assigneeAgentId: 'agt_2',
      assigneeUserId: 'user_bob',
      current: { agentId: 'agt_1', userId: null },
      now,
    });
    expect(rows.map((r) => r.assignment?.kind)).toEqual(['agent', 'member']);
  });

  it('refuses to invent an actor when the viewer identity is unknown', () => {
    expect(
      buildOptimisticAssignmentActivities({
        assigneeAgentId: 'agt_1',
        current: { agentId: null, userId: null },
        now,
      }),
    ).toEqual([]);
  });
});

describe('buildOptimisticCommentActivity', () => {
  it('synthesizes the comment as the signed-in user, carrying the topic it replies to', () => {
    const row = buildOptimisticCommentActivity({
      actor,
      content: 'hello',
      editorData: { root: {} },
      now,
      topicId: 'tpc_1',
    });
    expect(row).toMatchObject({
      author: actor,
      content: 'hello',
      editorData: { root: {} },
      time: now,
      topicId: 'tpc_1',
      type: 'comment',
    });
    expect(isOptimisticActivityId(row?.id)).toBe(true);
  });

  it('does not invent an author when the viewer identity is unknown', () => {
    expect(buildOptimisticCommentActivity({ content: 'x', now })).toBeUndefined();
  });

  it('never mistakes a persisted id for a synthesized one', () => {
    expect(isOptimisticActivityId('cmt_abc')).toBe(false);
    expect(isOptimisticActivityId(undefined)).toBe(false);
  });
});

describe('appendOptimisticPropertyActivity', () => {
  const hop = (from: unknown, to: unknown, at = now, who = actor) =>
    buildOptimisticPropertyActivity({
      actor: who,
      change: { field: 'priority', from: from as number | null, to: to as number | null },
      now: at,
    })!;

  it('folds a second hop by the same person into the open row, keeping the first start', () => {
    const rows = appendOptimisticPropertyActivity([hop(1, 2)], hop(2, 3));

    expect(rows).toHaveLength(1);
    expect(rows[0].propertyChange).toMatchObject({ field: 'priority', from: 1, to: 3 });
  });

  it('drops the row entirely when the value is back where it started', () => {
    expect(appendOptimisticPropertyActivity([hop(1, 2)], hop(2, 1))).toEqual([]);
  });

  it('never folds into a server row — only synthesized ones are provisional', () => {
    const persisted = { ...hop(1, 2), id: 'tac_real' };

    expect(appendOptimisticPropertyActivity([persisted], hop(2, 3))).toHaveLength(2);
  });

  it('keeps two people apart', () => {
    const other = { ...actor, id: 'user_other' };

    expect(appendOptimisticPropertyActivity([hop(1, 2)], hop(2, 3, now, other))).toHaveLength(2);
  });

  it('starts a new row when the hop does not continue from the previous end', () => {
    expect(appendOptimisticPropertyActivity([hop(1, 2)], hop(4, 3))).toHaveLength(2);
  });

  it('starts a new row once the collapse window has lapsed', () => {
    const later = '2024-01-01T00:31:00.000Z';

    expect(appendOptimisticPropertyActivity([hop(1, 2)], hop(2, 3, later))).toHaveLength(2);
  });

  it('is a no-op for an absent row', () => {
    const existing = [hop(1, 2)];

    expect(appendOptimisticPropertyActivity(existing, undefined)).toBe(existing);
  });
});
