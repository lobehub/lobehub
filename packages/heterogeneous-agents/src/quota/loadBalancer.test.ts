import { describe, expect, it } from 'vitest';

import { type AccountLoad, assignAccounts, rankAccounts, selectAccount } from './loadBalancer';

const load = (accountId: string, patch: Partial<AccountLoad> = {}): AccountLoad => ({
  accountId,
  enabled: true,
  priority: 0,
  weeklyUtil: 20,
  ...patch,
});

describe('load balancer — authorized candidates only', () => {
  it('never picks an account outside the authorized set, even with the most headroom', () => {
    const pool = [load('global-free', { weeklyUtil: 0 }), load('mine', { weeklyUtil: 80 })];

    expect(selectAccount(pool, { authorizedAccountIds: ['mine'], now: 0 })?.accountId).toBe('mine');
    expect(
      rankAccounts(pool, { authorizedAccountIds: ['mine'], now: 0 }).map((a) => a.accountId),
    ).toEqual(['mine']);
  });

  it('returns null when nothing is authorized, rather than falling back to the global pool', () => {
    expect(selectAccount([load('a'), load('b')], { authorizedAccountIds: [], now: 0 })).toBeNull();
  });

  it('skips a disabled authorized account', () => {
    const pool = [load('off', { enabled: false, weeklyUtil: 0 }), load('on', { weeklyUtil: 50 })];
    expect(assignAccounts(pool, 3, { authorizedAccountIds: ['off', 'on'], now: 0 })).toEqual([
      'on',
      'on',
      'on',
    ]);
  });
});

describe('load balancer — agents sharing an account', () => {
  it('rotates each agent on its own stamps; sharing an account does not affect the other agent', () => {
    // Account `shared` is authorized for both agents. Agent A just used it,
    // agent B never has: the stamp is per agent (per binding), so B still
    // prefers it while A rotates away from it.
    const agentA = [
      load('shared', { lastSelectedAt: 1000 }),
      load('a-only', { lastSelectedAt: null }),
    ];
    const agentB = [
      load('shared', { lastSelectedAt: null }),
      load('b-only', { lastSelectedAt: 500 }),
    ];

    expect(
      selectAccount(agentA, { authorizedAccountIds: ['shared', 'a-only'], now: 2000 })?.accountId,
    ).toBe('a-only');
    expect(
      selectAccount(agentB, { authorizedAccountIds: ['shared', 'b-only'], now: 2000 })?.accountId,
    ).toBe('shared');
  });

  it("an agent cannot reach another agent's private account through the shared one", () => {
    const loads = [load('shared'), load('a-only', { weeklyUtil: 0 })];
    expect(
      assignAccounts(loads, 4, { authorizedAccountIds: ['shared'], now: 0 }).every(
        (id) => id === 'shared',
      ),
    ).toBe(true);
  });
});

describe('load balancer — rotation and concurrent spread', () => {
  it('spreads concurrent runs across the authorized accounts instead of piling onto one', () => {
    const pool = [
      load('a', { weeklyUtil: 10 }),
      load('b', { weeklyUtil: 30 }),
      load('c', { weeklyUtil: 50 }),
    ];
    const picks = assignAccounts(pool, 6, { authorizedAccountIds: ['a', 'b', 'c'], now: 0 });

    // First round follows headroom, then strict least-recently-selected rotation.
    expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('prefers the least recently selected account for consecutive runs', () => {
    const pool = [
      load('a', { lastSelectedAt: 300, weeklyUtil: 0 }),
      load('b', { lastSelectedAt: 100, weeklyUtil: 60 }),
      load('c', { lastSelectedAt: 200, weeklyUtil: 10 }),
    ];
    expect(rankAccounts(pool, { now: 1000 }).map((a) => a.accountId)).toEqual(['b', 'c', 'a']);
  });

  it('keeps a nearly spent week as a last resort while healthier accounts remain', () => {
    const pool = [
      load('low', { weeklyUtil: 95 }),
      load('ok', { lastSelectedAt: 999, weeklyUtil: 40 }),
    ];
    expect(assignAccounts(pool, 2, { now: 1000 })).toEqual(['ok', 'ok']);
    // once nothing healthier is left, the low-headroom account still runs
    expect(selectAccount([load('low', { weeklyUtil: 95 })], { now: 0 })?.accountId).toBe('low');
  });

  it('breaks full ties deterministically by priority, then account id', () => {
    expect(
      rankAccounts([load('z'), load('y'), load('x', { priority: -1 })], { now: 0 }).map(
        (a) => a.accountId,
      ),
    ).toEqual(['x', 'y', 'z']);
  });
});

describe('load balancer — a single authorized account', () => {
  it('runs every run on the only authorized account', () => {
    expect(assignAccounts([load('only')], 3, { authorizedAccountIds: ['only'], now: 0 })).toEqual([
      'only',
      'only',
      'only',
    ]);
  });

  it('returns null once that account is exhausted or cooling down', () => {
    expect(
      selectAccount([load('only', { weeklyUtil: 100 })], {
        authorizedAccountIds: ['only'],
        now: 0,
      }),
    ).toBeNull();
    expect(
      selectAccount([load('only', { rateLimitedUntil: 5000 })], {
        authorizedAccountIds: ['only'],
        now: 1000,
      }),
    ).toBeNull();
  });
});
