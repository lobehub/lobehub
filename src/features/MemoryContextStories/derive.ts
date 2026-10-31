import {
  type MemoryContextStoryDossier,
  type MemoryContextStorySummary,
  type UserMemoryDossierStatus,
} from '@lobechat/types';

export const STORY_STATUSES: UserMemoryDossierStatus[] = ['active', 'dormant', 'closed'];

const haystackOf = (story: MemoryContextStorySummary) =>
  [story.title, story.now, ...(story.nextSteps ?? []), ...(story.openQuestions ?? [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

/** Cards grouped by status, newest progress first inside each group. */
export const groupStories = (stories: MemoryContextStorySummary[], keyword = '') => {
  const needle = keyword.trim().toLowerCase();
  const visible = needle ? stories.filter((s) => haystackOf(s).includes(needle)) : stories;
  const time = (s: MemoryContextStorySummary) =>
    s.lastEvidenceAt ? new Date(s.lastEvidenceAt).getTime() : 0;
  const sorted = [...visible].sort((a, b) => time(b) - time(a));

  return STORY_STATUSES.map((status) => ({
    status,
    stories: sorted.filter((s) => s.status === status),
  }));
};

/**
 * Dossiers that moved over several conversations are the story; one-record dossiers are listed
 * apart so they do not crowd it.
 */
export const splitDossiers = (dossiers: MemoryContextStoryDossier[]) => ({
  dossiers: dossiers.filter((d) => d.activityCount > 1),
  scattered: dossiers.filter((d) => d.activityCount <= 1),
});
