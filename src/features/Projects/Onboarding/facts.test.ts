import { describe, expect, it } from 'vitest';

import { toMemberSource, toOnboardingFacts } from './facts';

describe('toMemberSource', () => {
  it('is unknown while the member list is loading', () => {
    expect(toMemberSource({ data: undefined, isLoading: true }).rows).toBeUndefined();
  });

  it('treats a finished request without data as no members so the card still shows', () => {
    expect(toMemberSource({ data: undefined, isLoading: false }).rows).toEqual([]);
  });

  it('passes loaded members through', () => {
    expect(toMemberSource({ data: [{ id: 'u1' }], isLoading: false }).rows).toEqual([{ id: 'u1' }]);
  });
});

const loaded = <T>(rows: T[]) => ({ error: undefined, rows });
const pending = { error: undefined, rows: undefined };

const base = {
  directories: loaded([{ id: 'd1' }]),
  goals: loaded([]),
  knowledgeBaseCount: 1,
  members: loaded([{ id: 'u1' }, { id: 'u2' }]),
  sites: loaded([{ lastSeenAt: null }]),
  tasks: [{ id: 't1' }, { id: 't2' }],
  topics: loaded([{ id: 'tpc_1' }]),
};

describe('toOnboardingFacts', () => {
  it('counts the project tasks, the project topics and every connection', () => {
    expect(toOnboardingFacts(base)).toEqual({
      directoryCount: 1,
      goalCount: 0,
      knowledgeBaseCount: 1,
      siteCount: 1,
      sitesSeen: false,
      taskCount: 2,
      topicCount: 1,
      workspaceMemberCount: 2,
    });
  });

  it('marks the script seen once any site has reported in', () => {
    expect(
      toOnboardingFacts({
        ...base,
        sites: loaded([{ lastSeenAt: null }, { lastSeenAt: '2026-11-05' }]),
      }).sitesSeen,
    ).toBe(true);
  });

  it('keeps a still-loading source unknown and a failed one empty', () => {
    const facts = toOnboardingFacts({
      ...base,
      sites: { error: new Error('sites failed'), rows: undefined },
      topics: pending,
    });
    expect(facts.topicCount).toBeUndefined();
    expect(facts.siteCount).toBe(0);
    expect(facts.sitesSeen).toBe(false);
  });

  it('treats a project detail without its task list as having none', () => {
    expect(toOnboardingFacts({ ...base, tasks: undefined }).taskCount).toBe(0);
  });
});
