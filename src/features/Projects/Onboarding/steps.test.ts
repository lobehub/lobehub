import { describe, expect, it } from 'vitest';

import { getOnboardingCardVisible, getOnboardingChecklist, toFactCount } from './steps';

const empty = {
  directoryCount: 0,
  goalCount: 0,
  knowledgeBaseCount: 0,
  siteCount: 0,
  sitesSeen: false,
  taskCount: 0,
  topicCount: 0,
  workspaceMemberCount: 1,
};

const basicKeys = (result: ReturnType<typeof getOnboardingChecklist>) =>
  result.basics.map((s) => s.key);

describe('getOnboardingChecklist basics', () => {
  it('asks every workspace project to bring in tasks, start a chat and invite members', () => {
    expect(basicKeys(getOnboardingChecklist({ inWorkspace: true }, empty))).toEqual([
      'importTasks',
      'firstChat',
      'inviteMembers',
    ]);
  });

  it('leaves out inviting members in a personal space', () => {
    expect(basicKeys(getOnboardingChecklist({ inWorkspace: false }, empty))).toEqual([
      'importTasks',
      'firstChat',
    ]);
  });

  it('ticks each basic step from its own fact and counts only the basics', () => {
    const result = getOnboardingChecklist(
      { inWorkspace: true },
      { ...empty, directoryCount: 2, goalCount: 1, taskCount: 400, workspaceMemberCount: 3 },
    );
    expect(result.basics).toEqual([
      { done: true, key: 'importTasks' },
      { done: false, key: 'firstChat' },
      { done: true, key: 'inviteMembers' },
    ]);
    expect(result.completed).toBe(2);
    expect(result.total).toBe(3);
  });

  it('counts the first chat once the project has a topic', () => {
    const result = getOnboardingChecklist({ inWorkspace: false }, { ...empty, topicCount: 1 });
    expect(result.basics.find((s) => s.key === 'firstChat')?.done).toBe(true);
  });

  it('reports loading while a basic fact is unknown, but not while a connect fact is', () => {
    const { topicCount: _, ...noTopics } = empty;
    expect(getOnboardingChecklist({ inWorkspace: false }, noTopics).loading).toBe(true);
    const { directoryCount: __, ...noDirectories } = empty;
    expect(getOnboardingChecklist({ inWorkspace: false }, noDirectories).loading).toBe(false);
    const { workspaceMemberCount: ___, ...noMembers } = empty;
    expect(getOnboardingChecklist({ inWorkspace: false }, noMembers).loading).toBe(false);
    expect(getOnboardingChecklist({ inWorkspace: true }, noMembers).loading).toBe(true);
  });
});

describe('getOnboardingChecklist connect', () => {
  it('lists code folders first, then site, library and goal', () => {
    expect(getOnboardingChecklist({ inWorkspace: false }, empty).connect.map((c) => c.key)).toEqual(
      ['directory', 'site', 'knowledge', 'goal'],
    );
  });

  it('carries each count and marks a connection done once it has one', () => {
    const connect = getOnboardingChecklist(
      { inWorkspace: false },
      { ...empty, directoryCount: 2, knowledgeBaseCount: 1 },
    ).connect;
    expect(connect.find((c) => c.key === 'directory')).toMatchObject({ count: 2, done: true });
    expect(connect.find((c) => c.key === 'knowledge')).toMatchObject({ count: 1, done: true });
    expect(connect.find((c) => c.key === 'goal')).toMatchObject({ count: 0, done: false });
  });

  it.each([
    ['none', { siteCount: 0, sitesSeen: false }, false],
    ['waiting', { siteCount: 1, sitesSeen: false }, false],
    ['seen', { siteCount: 1, sitesSeen: true }, true],
  ] as const)('reports the site as %s', (state, facts, done) => {
    const site = getOnboardingChecklist(
      { inWorkspace: false },
      { ...empty, ...facts },
    ).connect.find((c) => c.key === 'site');
    expect(site).toMatchObject({ done, site: state });
  });

  it('shows an unknown connection as not done', () => {
    const { directoryCount: _, ...rest } = empty;
    expect(
      getOnboardingChecklist({ inWorkspace: false }, rest).connect.find(
        (c) => c.key === 'directory',
      ),
    ).toMatchObject({ count: 0, done: false });
  });
});

describe('toFactCount', () => {
  it('counts loaded rows', () => {
    expect(toFactCount([1, 2], undefined)).toBe(2);
  });

  it('treats a failed source as empty so it never blocks the checklist', () => {
    expect(toFactCount(undefined, new Error('goals failed'))).toBe(0);
  });

  it('is unknown while the source is still loading', () => {
    expect(toFactCount(undefined, undefined)).toBeUndefined();
  });
});

describe('getOnboardingCardVisible', () => {
  const open = getOnboardingChecklist({ inWorkspace: false }, empty);
  const finished = getOnboardingChecklist(
    { inWorkspace: false },
    { ...empty, taskCount: 3, topicCount: 1 },
  );

  it('shows an open checklist to someone who can manage the project', () => {
    expect(getOnboardingCardVisible(open, { canManage: true, dismissed: false })).toBe(true);
  });

  it('hides once the basics are done even when nothing is connected', () => {
    expect(getOnboardingCardVisible(finished, { canManage: true, dismissed: false })).toBe(false);
  });

  it.each([
    ['while loading', { ...open, loading: true }, { canManage: true, dismissed: false }],
    ['after it was dismissed', open, { canManage: true, dismissed: true }],
    ['to a viewer', open, { canManage: false, dismissed: false }],
  ] as const)('stays hidden %s', (_, checklist, viewer) => {
    expect(getOnboardingCardVisible(checklist, viewer)).toBe(false);
  });
});
