import type { GoalStatus } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import type { GoalListItem } from '@/store/goal/initialState';

import {
  buildHomeGoalEntries,
  homeGoalHref,
  indexAcceptanceStatuses,
  resolveHomeGoalView,
} from './homeGoals';

type GoalOverrides = Omit<Partial<GoalListItem>, 'goal' | 'id'> & {
  goal?: Partial<NonNullable<GoalListItem['goal']>>;
  id: string;
};

const goal = (overrides: GoalOverrides): GoalListItem =>
  ({
    assigneeAgentId: 'agt_1',
    goal: { id: `g-${overrides.id}`, maxRounds: 3, status: 'running' },
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
      goal({ id: 'r1', goal: { status: 'running' } }),
      goal({ id: 'd1', goal: { status: 'review' } }),
      goal({ id: 'r2', goal: { status: 'verifying' } }),
    ];

    const entries = buildHomeGoalEntries(goals);

    expect(titlesOf(entries)).toEqual(['goal d1', 'goal r1', 'goal r2']);
    expect(entries.map(({ bucket }) => bucket)).toEqual(['review', 'running', 'running']);
  });

  it('drops goals that are finished or parked', () => {
    const goals = [
      goal({ id: 'a', goal: { status: 'canceled' } }),
      goal({ id: 'b', goal: { status: 'failed' } }),
      goal({ id: 'c', goal: { status: 'paused' } }),
      goal({ id: 'd', goal: { status: 'achieved' } }),
      goal({ id: 'e', goal: { status: 'running' } }),
    ];

    expect(titlesOf(buildHomeGoalEntries(goals))).toEqual(['goal e']);
  });

  it('reads a review goal as pending the user even without an acceptance read', () => {
    const goals = [goal({ id: 'live', goal: { status: 'review' } })];

    const [entry] = buildHomeGoalEntries(goals);

    expect(entry.bucket).toBe('review');
    expect(entry.statusKey).toBe('goalList.status.review');
  });

  it('keeps a verifying goal in the running bucket', () => {
    const goals = [goal({ id: 'v', goal: { status: 'verifying' } })];

    const [entry] = buildHomeGoalEntries(goals);

    expect(entry.bucket).toBe('running');
    expect(entry.statusKey).toBe('goalList.status.verifying');
  });

  it('carries the round budget and falls back to the identifier for an unnamed goal', () => {
    const goals = [
      goal({
        goal: { id: 'g-x', maxRounds: 5, status: 'running' },
        id: 'x',
        instruction: '',
        name: null,
        totalTopics: 1,
      }),
    ];

    expect(buildHomeGoalEntries(goals)[0]).toMatchObject({
      agentId: 'agt_1',
      maxRounds: 5,
      rounds: 1,
      title: 'T-x',
    });
  });

  it('reports no round budget when the goal entity carries none', () => {
    const goals = [goal({ goal: { id: 'g-x', maxRounds: null, status: 'running' }, id: 'x' })];

    expect(buildHomeGoalEntries(goals)[0].maxRounds).toBeNull();
  });
});

describe('resolveHomeGoalView', () => {
  const entries = (count: number, status: GoalStatus = 'running') =>
    buildHomeGoalEntries(
      Array.from({ length: count }, (_, index) =>
        goal({ goal: { id: `g${index}`, status }, id: `g${index}` }),
      ),
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
      ...Array.from({ length: 6 }, (_, index) =>
        goal({ goal: { id: `g-r${index}`, status: 'running' }, id: `r${index}` }),
      ),
      goal({ goal: { id: 'g-d1', status: 'review' }, id: 'd1' }),
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
