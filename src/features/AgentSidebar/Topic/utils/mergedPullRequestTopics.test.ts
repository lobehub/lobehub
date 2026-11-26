import type { DeviceGitPullRequestDetail, TopicPullRequestItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type ChatTopic } from '@/types/topic';

import {
  getArchivableTopics,
  getMergedPullRequestTopics,
  hasLandedPullRequests,
  pullRequestIdentityKey,
} from './mergedPullRequestTopics';

const topic = (id: string, extra: Partial<ChatTopic> = {}) =>
  ({ createdAt: 0, id, title: id, updatedAt: 0, ...extra }) as ChatTopic;

const pr = (
  number: number,
  status: string | null,
  extra: Partial<TopicPullRequestItem> = {},
): TopicPullRequestItem => ({
  identifier: `lobehub/lobehub#${number}`,
  linkedAt: new Date('2026-11-20T00:00:00Z'),
  number,
  repoFullName: 'lobehub/lobehub',
  scm: null,
  source: 'created',
  status,
  title: null,
  url: null,
  vouched: true,
  workId: `work-${number}`,
  ...extra,
});

const appState = (state: 'closed' | 'merged' | 'open') =>
  ({
    autoFix: {
      changeRequestId: 'scr',
      enabled: true,
      maxWakes: 3,
      ownerTopic: null,
      ownerTopicId: null,
      wakeCount: 0,
    },
    ciStatus: null,
    isDraft: false,
    mergedAt: state === 'merged' ? new Date('2026-11-21T00:00:00Z') : null,
    reviewDecision: null,
    state,
    title: null,
    updatedAt: new Date(),
  }) satisfies TopicPullRequestItem['scm'];

describe('hasLandedPullRequests', () => {
  it.each([
    ['one merged PR', [{ state: 'merged' }], true],
    ['merged plus a superseded closed PR', [{ state: 'merged' }, { state: 'closed' }], true],
    ['a merged PR next to one still open', [{ state: 'merged' }, { state: 'open' }], false],
    ['only closed PRs', [{ state: 'closed' }], false],
    ['no PR', [], false],
  ] as const)('%s → %s', (_, views, expected) => {
    expect(hasLandedPullRequests(views.map((view) => ({ ...view, vouched: true })))).toBe(expected);
  });

  it('ignores PRs the app cannot vouch for', () => {
    // An unvouched branch match can be someone else's PR: it neither archives…
    expect(hasLandedPullRequests([{ state: 'merged', vouched: false }])).toBe(false);
    // …nor keeps a topic whose own PR landed.
    expect(
      hasLandedPullRequests([
        { state: 'merged', vouched: true },
        { state: 'open', vouched: false },
      ]),
    ).toBe(true);
  });
});

describe('getArchivableTopics', () => {
  const topics = [
    topic('active', { status: 'active', userId: 'u1' }),
    topic('plain', { userId: 'u2' }),
    topic('completed', { status: 'completed', userId: 'u1' }),
    topic('archived', { status: 'archived', userId: 'u1' }),
    topic('unread', { status: 'unread', userId: 'u1' }),
  ];

  it('keeps open topics only', () => {
    expect(getArchivableTopics(topics).map((t) => t.id)).toEqual(['active', 'plain']);
  });

  it('keeps one owner’s topics when asked, none for an unknown owner', () => {
    expect(getArchivableTopics(topics, 'u1').map((t) => t.id)).toEqual(['active']);
    expect(getArchivableTopics(topics, null)).toEqual([]);
  });
});

describe('getMergedPullRequestTopics', () => {
  it('selects the topics whose Work-row PRs have landed', () => {
    const topics = [
      topic('agent-merged'),
      topic('app-merged'),
      topic('app-reopened'),
      topic('mixed'),
      topic('none'),
      topic('unknown'),
    ];

    const merged = getMergedPullRequestTopics(topics, {
      // `gh pr merge` in the conversation left the Work row merged.
      'agent-merged': [pr(1, 'merged')],
      // The GitHub App's state wins over the Work row's.
      'app-merged': [pr(2, 'open', { scm: appState('merged') })],
      'app-reopened': [pr(3, 'merged', { scm: appState('open') })],
      'mixed': [pr(4, 'open'), pr(5, 'merged')],
      // Linked, but nothing knows its state yet: it may still be open.
      'unknown': [pr(6, null)],
    });

    expect(merged.map((t) => t.id)).toEqual(['agent-merged', 'app-merged']);
  });

  it('takes a merge only the device saw (merged on GitHub, no App)', () => {
    const detail = {
      mergedAt: '2026-11-21T00:00:00Z',
      number: 7,
      repo: { name: 'LobeHub', owner: 'LobeHub' },
      state: 'merged',
      title: 'Device read',
      url: 'https://github.com/lobehub/lobehub/pull/7',
    } as DeviceGitPullRequestDetail;
    const byTopic = { t: [pr(7, 'open')] };

    expect(getMergedPullRequestTopics([topic('t')], byTopic)).toEqual([]);
    expect(
      getMergedPullRequestTopics(
        [topic('t')],
        byTopic,
        new Map([[pullRequestIdentityKey('LobeHub/LobeHub', 7), detail]]),
      ).map((t) => t.id),
    ).toEqual(['t']);
  });
});
