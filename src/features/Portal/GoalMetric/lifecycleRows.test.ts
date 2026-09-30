import type { GoalGraphEvent } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildLifecycleDays } from './lifecycleRows';

/**
 * The shapes below are the ones the coordinator actually writes: one
 * `Attached Work version <id> as produced` event per deliverable a settle
 * attaches, all within the same second, plus bookkeeping rows for the task
 * container of each node.
 */
const attach = (
  versionId: string,
  {
    at,
    eventId,
    nodeId,
    relation = 'produced',
  }: {
    at: string;
    eventId: string;
    nodeId: string;
    relation?: string;
  },
): GoalGraphEvent => ({
  actorId: null,
  actorType: 'system',
  createdAt: new Date(at),
  entityId: nodeId,
  entityType: 'node',
  eventType: 'updated',
  goalId: 'goal-1',
  id: eventId,
  operationId: null,
  reason: `Attached Work version ${versionId} as ${relation}`,
  taskId: null,
});

/** Version → Work map, the two halves of the graph's joined display. */
const worksOf = (entries: [string, { type: string; workId: string }][]) => {
  const map = new Map(entries);
  return {
    workIdOf: (id: string) => map.get(id)?.workId,
    workTypeOf: (id: string) => map.get(id)?.type,
  };
};

const docs = worksOf([
  ['v1', { type: 'document', workId: 'wk_backlog' }],
  ['v2', { type: 'document', workId: 'wk_backlog' }],
  ['v3', { type: 'document', workId: 'wk_backlog' }],
  ['pr1', { type: 'external', workId: 'wk_pr1' }],
  ['pr2', { type: 'external', workId: 'wk_pr2' }],
  ['task1', { type: 'task', workId: 'wk_task' }],
  ['task2', { type: 'task', workId: 'wk_task' }],
]);

const rowsOf = (days: ReturnType<typeof buildLifecycleDays>) =>
  days.flatMap((day) => day.groups.flatMap((group) => group.rows));

describe('buildLifecycleDays', () => {
  it('keeps the first claim of a deliverable and drops later ones', () => {
    // The reported shape: one shared backlog document revised in three
    // different tasks' runs was declared as each of their deliverables, so the
    // goal history showed one document delivered three times.
    const days = buildLifecycleDays(
      [
        attach('v1', { at: '2026-09-27T07:33:41.813Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('v2', { at: '2026-09-27T08:01:15.137Z', eventId: 'e2', nodeId: 'node-b' }),
        attach('v3', { at: '2026-09-27T08:16:30.339Z', eventId: 'e3', nodeId: 'node-c' }),
      ],
      docs,
    );

    const rows = rowsOf(days);
    expect(rows).toHaveLength(1);
    expect(rows[0].event.id).toBe('e1');
    expect(rows[0].event.entityId).toBe('node-a');
  });

  it('keeps the claim when only one node ever made it', () => {
    const days = buildLifecycleDays(
      [attach('v1', { at: '2026-09-27T07:33:41.813Z', eventId: 'e1', nodeId: 'node-a' })],
      docs,
    );

    expect(rowsOf(days)).toHaveLength(1);
  });

  it('folds a settle batch into one row with a row per deliverable', () => {
    // Four pull requests attached in one step read as one event with four
    // cards, instead of four identical "produces a deliverable" sentences.
    const days = buildLifecycleDays(
      [
        attach('pr1', { at: '2026-09-28T04:02:51.041Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('pr2', { at: '2026-09-28T04:02:51.197Z', eventId: 'e2', nodeId: 'node-a' }),
      ],
      docs,
    );

    const groups = days.flatMap((day) => day.groups);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.event.id)).toEqual(['e2', 'e1']);
  });

  it('does not fold deliverables of different nodes or different moments', () => {
    const otherNode = buildLifecycleDays(
      [
        attach('pr1', { at: '2026-09-28T04:02:51.041Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('pr2', { at: '2026-09-28T04:02:51.197Z', eventId: 'e2', nodeId: 'node-b' }),
      ],
      docs,
    );
    expect(otherNode.flatMap((day) => day.groups)).toHaveLength(2);

    const otherMinute = buildLifecycleDays(
      [
        attach('pr1', { at: '2026-09-28T04:02:51.041Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('pr2', { at: '2026-09-28T04:03:02.000Z', eventId: 'e2', nodeId: 'node-a' }),
      ],
      docs,
    );
    expect(otherMinute.flatMap((day) => day.groups)).toHaveLength(2);
  });

  it('drops the task container a node registers, and folds nothing into it', () => {
    const days = buildLifecycleDays(
      [
        attach('task1', { at: '2026-09-28T04:02:50.938Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('pr1', { at: '2026-09-28T04:02:51.041Z', eventId: 'e2', nodeId: 'node-a' }),
      ],
      docs,
    );

    const rows = rowsOf(days);
    expect(rows).toHaveLength(1);
    expect(rows[0].presentation.workVersion?.id).toBe('pr1');
  });

  it('never folds rows that are not deliverables', () => {
    const starts: GoalGraphEvent[] = ['e1', 'e2'].map((id, index) => ({
      actorId: null,
      actorType: 'system',
      createdAt: new Date(`2026-09-28T04:02:5${index}.000Z`),
      entityId: 'node-a',
      entityType: 'node',
      eventType: 'activated',
      goalId: 'goal-1',
      id,
      operationId: null,
      reason: 'Started attempt',
      taskId: null,
    }));

    expect(buildLifecycleDays(starts, docs).flatMap((day) => day.groups)).toHaveLength(2);
  });

  it('groups by day, newest first', () => {
    const days = buildLifecycleDays(
      [
        attach('v1', { at: '2026-09-27T07:33:41.813Z', eventId: 'e1', nodeId: 'node-a' }),
        attach('pr1', { at: '2026-09-28T04:02:51.041Z', eventId: 'e2', nodeId: 'node-a' }),
      ],
      docs,
    );

    expect(days).toHaveLength(2);
    expect(days[0].day.format('YYYY-MM-DD')).toBe('2026-09-28');
    expect(days[1].day.format('YYYY-MM-DD')).toBe('2026-09-27');
    expect(days[0].groups[0].rows[0].event.id).toBe('e2');
  });

  it('keeps an attached Work whose row is gone', () => {
    // Same rule the single-event presentation already followed: a version the
    // graph could not join still happened, it just cannot be named.
    const days = buildLifecycleDays(
      [attach('missing', { at: '2026-09-28T04:02:51.041Z', eventId: 'e1', nodeId: 'node-a' })],
      docs,
    );

    expect(rowsOf(days)).toHaveLength(1);
  });
});
