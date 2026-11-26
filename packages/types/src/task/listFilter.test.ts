import { describe, expect, it } from 'vitest';

import {
  countTaskListFilterConditions,
  matchesTaskListFilter,
  normalizeTaskListFilter,
  TASK_LIST_FILTER_NONE,
  type TaskListFilterTarget,
  toTaskListFilterAgentCreator,
} from './listFilter';

const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS);

const task = (overrides: Partial<TaskListFilterTarget> = {}): TaskListFilterTarget => ({
  assigneeAgentId: 'agt_a',
  assigneeUserId: 'user_a',
  completedAt: null,
  createdAt: daysAgo(3),
  createdByUserId: 'user_creator',
  description: null,
  identifier: 'T-12',
  instruction: 'Ship the filter menu',
  name: 'Task filter',
  priority: 2,
  projectId: 'proj_a',
  status: 'backlog',
  updatedAt: daysAgo(1),
  ...overrides,
});

describe('normalizeTaskListFilter', () => {
  it('returns undefined for missing or empty filters', () => {
    expect(normalizeTaskListFilter(undefined)).toBeUndefined();
    expect(normalizeTaskListFilter({})).toBeUndefined();
    expect(
      normalizeTaskListFilter({ content: '   ', status: { operator: 'is', values: [] } }),
    ).toBeUndefined();
  });

  it('dedupes and sorts values so equal filters share one key', () => {
    const a = normalizeTaskListFilter({
      priority: { operator: 'is', values: [3, 1, 3] },
      status: { operator: 'isNot', values: ['running', 'backlog'] },
    });
    const b = normalizeTaskListFilter({
      status: { operator: 'isNot', values: ['backlog', 'running', 'backlog'] },
      priority: { operator: 'is', values: [1, 3] },
    });
    expect(a).toEqual({
      priority: { operator: 'is', values: [1, 3] },
      status: { operator: 'isNot', values: ['backlog', 'running'] },
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('trims content and drops unknown date windows', () => {
    expect(
      normalizeTaskListFilter({
        content: '  menu ',
        createdAt: { operator: 'within', window: 'decade' as never },
      }),
    ).toEqual({ content: 'menu' });
  });

  it('counts the active conditions', () => {
    expect(countTaskListFilterConditions(undefined)).toBe(0);
    expect(
      countTaskListFilterConditions({
        content: 'x',
        status: { operator: 'is', values: ['backlog'] },
      }),
    ).toBe(2);
  });
});

describe('matchesTaskListFilter', () => {
  it('passes everything without a filter', () => {
    expect(matchesTaskListFilter(task(), undefined, NOW)).toBe(true);
  });

  it('matches an agent-created task by its member and by its agent', () => {
    const byAgent = task({ createdByAgentId: 'agt_writer' });
    const byMember = { operator: 'is' as const, values: ['user_creator'] };
    const byWriter = {
      operator: 'is' as const,
      values: [toTaskListFilterAgentCreator('agt_writer')],
    };

    expect(matchesTaskListFilter(task(), { creator: byMember }, NOW)).toBe(true);
    expect(matchesTaskListFilter(byAgent, { creator: byMember }, NOW)).toBe(true);
    expect(matchesTaskListFilter(byAgent, { creator: byWriter }, NOW)).toBe(true);
    expect(matchesTaskListFilter(task(), { creator: byWriter }, NOW)).toBe(false);
    expect(
      matchesTaskListFilter(task(), { creator: { ...byWriter, operator: 'isNot' } }, NOW),
    ).toBe(true);
    expect(
      matchesTaskListFilter(byAgent, { creator: { ...byMember, operator: 'isNot' } }, NOW),
    ).toBe(false);
  });

  it('matches value sets with is / isNot', () => {
    expect(
      matchesTaskListFilter(task(), { status: { operator: 'is', values: ['backlog'] } }, NOW),
    ).toBe(true);
    expect(
      matchesTaskListFilter(task(), { status: { operator: 'isNot', values: ['backlog'] } }, NOW),
    ).toBe(false);
    expect(
      matchesTaskListFilter(task(), { priority: { operator: 'is', values: [1, 2] } }, NOW),
    ).toBe(true);
  });

  it('treats a missing priority as "no priority" (0)', () => {
    expect(
      matchesTaskListFilter(
        task({ priority: null }),
        { priority: { operator: 'is', values: [0] } },
        NOW,
      ),
    ).toBe(true);
  });

  it('matches the "none" sentinel against missing ids', () => {
    const unassigned = task({ assigneeAgentId: null, projectId: null });
    expect(
      matchesTaskListFilter(
        unassigned,
        { agent: { operator: 'is', values: [TASK_LIST_FILTER_NONE] } },
        NOW,
      ),
    ).toBe(true);
    // "is not A" keeps the unassigned rows…
    expect(
      matchesTaskListFilter(unassigned, { agent: { operator: 'isNot', values: ['agt_a'] } }, NOW),
    ).toBe(true);
    // …unless "none" itself is excluded.
    expect(
      matchesTaskListFilter(
        unassigned,
        { project: { operator: 'isNot', values: [TASK_LIST_FILTER_NONE] } },
        NOW,
      ),
    ).toBe(false);
  });

  it('ANDs fields together', () => {
    expect(
      matchesTaskListFilter(
        task(),
        {
          agent: { operator: 'is', values: ['agt_a'] },
          status: { operator: 'is', values: ['running'] },
        },
        NOW,
      ),
    ).toBe(false);
  });

  it('resolves relative date windows', () => {
    expect(
      matchesTaskListFilter(task(), { createdAt: { operator: 'within', window: 'week' } }, NOW),
    ).toBe(true);
    expect(
      matchesTaskListFilter(task(), { createdAt: { operator: 'before', window: 'week' } }, NOW),
    ).toBe(false);
    expect(
      matchesTaskListFilter(task(), { createdAt: { operator: 'within', window: 'day' } }, NOW),
    ).toBe(false);
  });

  it('never matches a date condition on a missing timestamp', () => {
    expect(
      matchesTaskListFilter(task(), { completedAt: { operator: 'within', window: 'month' } }, NOW),
    ).toBe(false);
    expect(
      matchesTaskListFilter(task(), { completedAt: { operator: 'before', window: 'month' } }, NOW),
    ).toBe(false);
  });

  it('searches name, identifier, description and instruction case-insensitively', () => {
    expect(matchesTaskListFilter(task(), { content: 'FILTER' }, NOW)).toBe(true);
    expect(matchesTaskListFilter(task(), { content: 't-12' }, NOW)).toBe(true);
    expect(matchesTaskListFilter(task(), { content: 'ship the' }, NOW)).toBe(true);
    expect(matchesTaskListFilter(task(), { content: 'billing' }, NOW)).toBe(false);
  });
});

describe('matchesTaskListFilter label', () => {
  const labeled = task({
    labels: [
      { id: 'bug', parentId: 'type' },
      { id: 'fe', parentId: null },
    ],
  });
  const unlabeled = task({ labels: [] });

  it('matches a label, its group, or no labels', () => {
    const is = (values: string[]) => ({ label: { operator: 'is' as const, values } });
    expect(matchesTaskListFilter(labeled, is(['bug']), NOW)).toBe(true);
    expect(matchesTaskListFilter(labeled, is(['type']), NOW)).toBe(true);
    expect(matchesTaskListFilter(labeled, is(['other']), NOW)).toBe(false);
    expect(matchesTaskListFilter(unlabeled, is([TASK_LIST_FILTER_NONE]), NOW)).toBe(true);
    expect(matchesTaskListFilter(labeled, is([TASK_LIST_FILTER_NONE]), NOW)).toBe(false);
    // a row without the field counts as unlabeled
    expect(matchesTaskListFilter(task(), is([TASK_LIST_FILTER_NONE]), NOW)).toBe(true);
  });

  it('isNot excludes rows carrying any value', () => {
    const isNot = (values: string[]) => ({ label: { operator: 'isNot' as const, values } });
    expect(matchesTaskListFilter(labeled, isNot(['fe']), NOW)).toBe(false);
    expect(matchesTaskListFilter(unlabeled, isNot(['fe']), NOW)).toBe(true);
    expect(matchesTaskListFilter(labeled, isNot([TASK_LIST_FILTER_NONE]), NOW)).toBe(true);
  });

  it('normalizes the label set', () => {
    expect(normalizeTaskListFilter({ label: { operator: 'is', values: ['b', 'a', 'b'] } })).toEqual(
      { label: { operator: 'is', values: ['a', 'b'] } },
    );
  });
});
