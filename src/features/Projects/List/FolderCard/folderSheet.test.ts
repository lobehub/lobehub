import { describe, expect, it } from 'vitest';

import type { ProjectOverview } from '@/store/project';

import { isRichFolder, resolveFolderSheet } from './folderSheet';

const topic = (title: string, day: number) => ({
  id: `tpc_${title}`,
  summary: null,
  title,
  updatedAt: new Date(2026, 0, day),
});

const overview = (patch: Partial<ProjectOverview> = {}): ProjectOverview => ({
  agentCount: 1,
  agents: [],
  projectId: 'prj_1',
  recentTopics: [],
  taskCount: 0,
  taskDoneCount: 0,
  topicCount: 0,
  ...patch,
});

describe('resolveFolderSheet', () => {
  it('waits for the overview batch before claiming there are no conversations', () => {
    expect(resolveFolderSheet(undefined, false)).toEqual({ kind: 'pending' });
  });

  it('shows the brief when the loaded batch has no row for the project', () => {
    expect(resolveFolderSheet(undefined, true)).toEqual({ kind: 'intro' });
  });

  it('shows the brief when the project has no conversations', () => {
    expect(resolveFolderSheet(overview(), true)).toEqual({ kind: 'intro' });
  });

  it('heads the paper with the latest conversation and lists up to three others', () => {
    const topics = [topic('e', 5), topic('d', 4), topic('c', 3), topic('b', 2), topic('a', 1)];
    const sheet = resolveFolderSheet(overview({ recentTopics: topics, topicCount: 5 }), true);

    expect(sheet).toEqual({ kind: 'topics', latest: topics[0], others: topics.slice(1, 4) });
  });

  it('lists no rows when the project has a single conversation', () => {
    const only = topic('only', 1);

    expect(resolveFolderSheet(overview({ recentTopics: [only], topicCount: 1 }), true)).toEqual({
      kind: 'topics',
      latest: only,
      others: [],
    });
  });
});

describe('isRichFolder', () => {
  it('is plain without an overview', () => {
    expect(isRichFolder(undefined)).toBe(false);
  });

  it('is plain with up to three conversations and no tasks', () => {
    expect(isRichFolder(overview({ topicCount: 3 }))).toBe(false);
  });

  it('is rich past three conversations', () => {
    expect(isRichFolder(overview({ topicCount: 4 }))).toBe(true);
  });

  it('is rich with any task', () => {
    expect(isRichFolder(overview({ taskCount: 1 }))).toBe(true);
  });
});
