import { describe, expect, it } from 'vitest';

import type { GoalListItem } from '@/store/goal/initialState';

import {
  buildHomeGoalEntries,
  homeGoalHref,
  indexAcceptanceStatuses,
  resolveHomeGoalView,
} from './homeGoals';

const goal = (overrides: Partial<GoalListItem> & Pick<GoalListItem, 'id'>): GoalListItem =>
  ({
    assigneeAgentId: 'agt_1',
    config: { goal: { maxIterations: 3 } },
    identifier: `T-${overrides.id}`,
    instruction: 'do the thing',
    name: `goal ${overrides.id}`,
    status: 'running',
    totalTopics: 1,
    ...overrides,
  }) as GoalListItem;

const titlesOf = (entries: { title: string }[]) => entries.map(({ title }) => title);

describe('indexAcceptanceStatuses', () => {
  it('indexes acceptances by subject id', () => {
    expect(
      indexAcceptanceStatuses([
        { status: 'delivered', subjectId: 'task_1' },
        { status: 'accepted', subjectId: 'task_2' },
      ]),
    ).toEqual({ task_1: 'delivered', task_2: 'accepted' });
  });

  it('tolerates a read that has not landed', () => {
    expect(indexAcceptanceStatuses()).toEqual({});
  });
});

describe('buildHomeGoalEntries', () => {
  it('puts the goals waiting on the user ahead of the ones still working', () => {
    const goals = [
      goal({ id: 'r1', status: 'running' }),
      goal({ id: 'd1', status: 'completed' }),
      goal({ id: 'r2', status: 'scheduled' }),
    ];

    const entries = buildHomeGoalEntries(goals);

    expect(titlesOf(entries)).toEqual(['goal d1', 'goal r1', 'goal r2']);
    expect(entries.map(({ bucket }) => bucket)).toEqual(['review', 'running', 'running']);
  });

  it('drops goals that are finished or parked', () => {
    const goals = [
      goal({ id: 'a', status: 'canceled' }),
      goal({ id: 'b', status: 'failed' }),
      goal({ id: 'c', status: 'paused' }),
      goal({ id: 'd', status: 'running' }),
    ];

    expect(titlesOf(buildHomeGoalEntries(goals))).toEqual(['goal d']);
  });

  it('lets an accepted acceptance retire a goal its task status still calls completed', () => {
    const goals = [goal({ id: 'done', status: 'completed' })];

    expect(buildHomeGoalEntries(goals, { done: 'accepted' })).toEqual([]);
  });

  it('reads a delivered acceptance as pending review even while the task runs on', () => {
    const goals = [goal({ id: 'live', status: 'running' })];

    const [entry] = buildHomeGoalEntries(goals, { live: 'delivered' });

    expect(entry.bucket).toBe('review');
    expect(entry.statusKey).toBe('goalList.status.review');
  });

  it('keeps a verifying goal in the running bucket', () => {
    const goals = [goal({ id: 'v', status: 'running' })];

    const [entry] = buildHomeGoalEntries(goals, { v: 'verifying' });

    expect(entry.bucket).toBe('running');
    expect(entry.statusKey).toBe('goalList.status.verifying');
  });

  it('carries the round budget and falls back to the identifier for an unnamed goal', () => {
    const goals = [
      goal({ config: { goal: { maxIterations: 5 } }, id: 'x', instruction: '', name: null }),
    ];

    expect(buildHomeGoalEntries(goals)[0]).toMatchObject({
      agentId: 'agt_1',
      maxRounds: 5,
      rounds: 1,
      title: 'T-x',
    });
  });

  it('reports no round budget when the goal config carries none', () => {
    const goals = [goal({ config: {}, id: 'x' })];

    expect(buildHomeGoalEntries(goals)[0].maxRounds).toBeNull();
  });
});

describe('resolveHomeGoalView', () => {
  const entries = (count: number, status = 'running') =>
    buildHomeGoalEntries(
      Array.from({ length: count }, (_, index) => goal({ id: `g${index}`, status })),
    );

  it('names each pile and leaves an empty one out', () => {
    const { buckets, collapsed } = resolveHomeGoalView(entries(2));

    expect(collapsed).toBe(false);
    expect(buckets.map(({ bucket }) => bucket)).toEqual(['running']);
    expect(buckets[0].entries).toHaveLength(2);
  });

  it('folds the tail once the card would stop being a card', () => {
    const { buckets, collapsed } = resolveHomeGoalView(entries(7));

    expect(collapsed).toBe(true);
    expect(buckets[0].entries).toHaveLength(5);
  });

  it('keeps the pile count honest while the tail is folded', () => {
    const { buckets } = resolveHomeGoalView(entries(7));

    expect(buckets[0].total).toBe(7);
  });

  it('shows everything once expanded', () => {
    const { buckets, collapsed } = resolveHomeGoalView(entries(7), true);

    expect(collapsed).toBe(false);
    expect(buckets[0].entries).toHaveLength(7);
  });

  it('cuts the least urgent rows, never the ones waiting on the user', () => {
    const goals = [
      ...Array.from({ length: 6 }, (_, index) => goal({ id: `r${index}`, status: 'running' })),
      goal({ id: 'd1', status: 'completed' }),
    ];

    const { buckets } = resolveHomeGoalView(buildHomeGoalEntries(goals));

    expect(buckets.map(({ bucket }) => bucket)).toEqual(['review', 'running']);
    expect(buckets[0].entries).toHaveLength(1);
    expect(buckets[1].entries).toHaveLength(4);
    expect(buckets[1].total).toBe(6);
  });
});

describe('homeGoalHref', () => {
  it('routes to the goal detail page under its owning agent', () => {
    const [entry] = buildHomeGoalEntries([goal({ id: 'g1' })]);

    expect(homeGoalHref(entry)).toBe('/agent/agt_1/goal/T-g1');
  });

  it('has nowhere to go for an unassigned goal', () => {
    const [entry] = buildHomeGoalEntries([goal({ assigneeAgentId: null, id: 'g1' })]);

    expect(homeGoalHref(entry)).toBeUndefined();
  });
});
