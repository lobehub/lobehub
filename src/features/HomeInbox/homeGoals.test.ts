import type { GoalStatus } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import type { GoalListItem } from '@/store/goal/initialState';

import { buildHomeGoalEntries, homeGoalHref, resolveHomeGoalView } from './homeGoals';

interface GoalOverrides {
  agentId?: string | null;
  goal?: Partial<GoalListItem['goal']>;
  id: string;
  pendingDecisions?: number;
  title?: string;
  workDone?: number;
  workTotal?: number;
}

const goal = ({ agentId = 'agt_1', id, goal: overrides, ...rest }: GoalOverrides): GoalListItem =>
  ({
    findingCount: 0,
    goal: { agentId, id: `g-${id}`, status: 'running', title: `goal ${id}`, ...overrides },
    pendingDecisions: 0,
    totalRunCost: 0,
    totalRunDuration: 0,
    workDone: 1,
    workTotal: 3,
    ...rest,
  }) as GoalListItem;

const titlesOf = (entries: { title: string }[]) => entries.map(({ title }) => title);

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

  it('carries the graph roll-up the row renders', () => {
    const goals = [goal({ id: 'x', pendingDecisions: 2, workDone: 2, workTotal: 5 })];

    expect(buildHomeGoalEntries(goals)[0]).toMatchObject({
      agentId: 'agt_1',
      id: 'g-x',
      pendingDecisions: 2,
      title: 'goal x',
      workDone: 2,
      workTotal: 5,
    });
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

    expect(homeGoalHref(entry)).toBe('/agent/agt_1/goal/g-g1');
  });

  it('has nowhere to go for an unassigned goal', () => {
    const [entry] = buildHomeGoalEntries([goal({ agentId: null, id: 'g1' })]);

    expect(homeGoalHref(entry)).toBeUndefined();
  });
});
