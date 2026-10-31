import { type MemoryContextStoryDossier, type MemoryContextStorySummary } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { groupStories, splitDossiers } from './derive';

const story = (
  id: string,
  status: MemoryContextStorySummary['status'],
  day: string | null,
  extra: Partial<MemoryContextStorySummary> = {},
): MemoryContextStorySummary => ({
  dossierCount: 1,
  evidenceCount: 1,
  firstSeenAt: null,
  id,
  lastEvidenceAt: day ? new Date(day) : null,
  nextSteps: [],
  now: null,
  openQuestions: [],
  status,
  title: id,
  ...extra,
});

describe('groupStories', () => {
  it('groups by status in a fixed order, newest progress first', () => {
    const groups = groupStories([
      story('a', 'active', '2026-10-01'),
      story('b', 'closed', '2025-01-01'),
      story('c', 'active', '2026-10-20'),
      story('d', 'dormant', null),
    ]);

    expect(groups.map((g) => [g.status, g.stories.map((s) => s.id)])).toEqual([
      ['active', ['c', 'a']],
      ['dormant', ['d']],
      ['closed', ['b']],
    ]);
  });

  it('matches the keyword against title, now, next steps and open questions', () => {
    const stories = [
      story('Pricing', 'active', '2026-10-01'),
      story('Scheduler', 'closed', '2025-01-01', { nextSteps: ['Ship CRON mode'] }),
      story('Other', 'dormant', '2026-06-01', { now: 'waiting' }),
    ];

    const ids = (keyword: string) =>
      groupStories(stories, keyword).flatMap((g) => g.stories.map((s) => s.id));
    expect(ids(' cron ')).toEqual(['Scheduler']);
    expect(ids('pricing')).toEqual(['Pricing']);
    expect(ids('nothing')).toEqual([]);
  });
});

describe('splitDossiers', () => {
  it('keeps one-record dossiers apart', () => {
    const dossier = (id: string, activityCount: number) =>
      ({ activityCount, id }) as MemoryContextStoryDossier;

    const { dossiers, scattered } = splitDossiers([
      dossier('a', 3),
      dossier('b', 1),
      dossier('c', 2),
    ]);
    expect(dossiers.map((d) => d.id)).toEqual(['a', 'c']);
    expect(scattered.map((d) => d.id)).toEqual(['b']);
  });
});
