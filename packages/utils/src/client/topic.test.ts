import type { ChatTopic } from '@lobechat/types';
import dayjs from 'dayjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getTopicWorkingDirectoryEffectivePath,
  getTopicWorkingDirectorySourcePath,
  groupTopicsByProject,
  groupTopicsByStatus,
  groupTopicsByTime,
  groupTopicsByUpdatedTime,
} from './topic';

// Mock current date to ensure consistent test results
const NOW = '2024-01-15T12:00:00Z';

beforeAll(() => {
  // Mock the current date
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

describe('groupTopicsByTime', () => {
  afterAll(() => {
    vi.useRealTimers();
  });

  // Helper function to create test topics
  const createTopic = (createdAt: number, title: string = 'Test Topic'): ChatTopic => ({
    id: createdAt.toString(),
    title,
    createdAt,
    updatedAt: createdAt,
  });

  it('should return empty array for empty input', () => {
    expect(groupTopicsByTime([])).toEqual([]);
  });

  it('should group topics created today', () => {
    const today = dayjs().valueOf();
    const topics = [createTopic(today)];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'today',
      children: topics,
    });
  });

  it('should group topics created yesterday', () => {
    const yesterday = dayjs().subtract(1, 'day').valueOf();
    const topics = [createTopic(yesterday)];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'yesterday',
      children: topics,
    });
  });

  it('should group topics created within the week', () => {
    const threeDaysAgo = dayjs().subtract(3, 'day').valueOf();
    const topics = [createTopic(threeDaysAgo)];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'week',
      children: topics,
    });
  });

  it('should group topics created this month', () => {
    const thisMonth = dayjs().startOf('month').add(1, 'day').valueOf();
    const topics = [createTopic(thisMonth)];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'month',
      children: topics,
    });
  });

  it('should group topics from previous years', () => {
    const lastYear = dayjs().subtract(1, 'year').valueOf();
    const topics = [createTopic(lastYear)];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: dayjs(lastYear).year().toString(),
      children: topics,
    });
  });

  it('should sort groups in correct order', () => {
    const today = dayjs().valueOf();
    const yesterday = dayjs().subtract(1, 'day').valueOf();
    const lastWeek = dayjs().subtract(5, 'day').valueOf();
    const lastMonth = dayjs().subtract(1, 'month').valueOf();
    const lastYear = dayjs().subtract(1, 'year').valueOf();

    const topics = [
      createTopic(lastYear, 'Last Year'),
      createTopic(lastMonth, 'Last Month'),
      createTopic(lastWeek, 'Last Week'),
      createTopic(yesterday, 'Yesterday'),
      createTopic(today, 'Today'),
    ];

    const result = groupTopicsByTime(topics);

    // Verify order of groups
    expect(result.map((g) => g.id)).toEqual([
      'today',
      'yesterday',
      'week',
      dayjs(lastYear).year().toString(),
    ]);
  });

  it('should sort topics within groups by createdAt in descending order', () => {
    const today1 = dayjs().hour(9).valueOf();
    const today2 = dayjs().hour(10).valueOf();
    const today3 = dayjs().hour(11).valueOf();

    const topics = [
      createTopic(today1, 'Morning'),
      createTopic(today2, 'Midday'),
      createTopic(today3, 'Afternoon'),
    ];

    const result = groupTopicsByTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('today');
    expect(result[0].children.map((t) => t.title)).toEqual(['Afternoon', 'Midday', 'Morning']);
  });
});

describe('groupTopicsByUpdatedTime', () => {
  afterAll(() => {
    vi.useRealTimers();
  });

  const createTopic = (
    createdAt: number,
    updatedAt: number,
    title: string = 'Test Topic',
  ): ChatTopic => ({
    id: `${createdAt}-${updatedAt}`,
    title,
    createdAt,
    updatedAt,
  });

  it('should return empty array for empty input', () => {
    expect(groupTopicsByUpdatedTime([])).toEqual([]);
  });

  it('should group topics by updatedAt instead of createdAt', () => {
    const lastYear = dayjs().subtract(1, 'year').valueOf();
    const today = dayjs().valueOf();

    // Topic created last year but updated today
    const topics = [createTopic(lastYear, today, 'Old but recently updated')];

    const result = groupTopicsByUpdatedTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('today');
    expect(result[0].children[0].title).toBe('Old but recently updated');
  });

  it('should sort topics within groups by updatedAt in descending order', () => {
    const createdAt = dayjs().subtract(1, 'month').valueOf();
    const updatedAt1 = dayjs().hour(9).valueOf();
    const updatedAt2 = dayjs().hour(10).valueOf();
    const updatedAt3 = dayjs().hour(11).valueOf();

    const topics = [
      createTopic(createdAt, updatedAt1, 'Morning update'),
      createTopic(createdAt, updatedAt2, 'Midday update'),
      createTopic(createdAt, updatedAt3, 'Afternoon update'),
    ];

    const result = groupTopicsByUpdatedTime(topics);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('today');
    expect(result[0].children.map((t) => t.title)).toEqual([
      'Afternoon update',
      'Midday update',
      'Morning update',
    ]);
  });

  it('should produce different grouping than groupTopicsByTime when updatedAt differs from createdAt', () => {
    const lastYear = dayjs().subtract(1, 'year').valueOf();
    const yesterday = dayjs().subtract(1, 'day').valueOf();

    // Created last year, updated yesterday
    const topics = [createTopic(lastYear, yesterday, 'Migrated topic')];

    const byCreated = groupTopicsByTime(topics);
    const byUpdated = groupTopicsByUpdatedTime(topics);

    // By createdAt: grouped under last year
    expect(byCreated[0].id).toBe(dayjs(lastYear).year().toString());

    // By updatedAt: grouped under yesterday
    expect(byUpdated[0].id).toBe('yesterday');
  });
});

describe('working directory topic helpers', () => {
  const createTopic = (
    id: string,
    metadata: ChatTopic['metadata'],
    updatedAt: number = 0,
  ): ChatTopic => ({
    createdAt: updatedAt,
    id,
    metadata,
    title: id,
    updatedAt,
  });

  it('preserves source and effective paths for worktree topics', () => {
    const topic = createTopic('worktree', {
      workingDirectory: '/repo-fix',
      workingDirectoryConfig: {
        git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
        path: '/repo',
        repoType: 'git',
      },
    });

    expect(getTopicWorkingDirectorySourcePath(topic)).toBe('/repo');
    expect(getTopicWorkingDirectoryEffectivePath(topic)).toBe('/repo-fix');
  });

  it('groups worktree topics under the source project', () => {
    const topics = [
      createTopic(
        'worktree',
        {
          workingDirectory: '/repo-fix',
          workingDirectoryConfig: {
            git: { activeWorktree: '/repo-fix', branch: 'fix', isWorktree: true },
            path: '/repo',
            repoType: 'git',
          },
        },
        2,
      ),
      createTopic('source', { workingDirectory: '/repo' }, 1),
    ];

    const result = groupTopicsByProject(topics, 'updatedAt');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'project:/repo', title: 'repo' });
    expect(result[0].children.map((topic) => topic.id)).toEqual(['worktree', 'source']);
  });
});

describe('groupTopicsByStatus', () => {
  const createTopic = (
    id: string,
    status: ChatTopic['status'],
    updatedAt: number = 0,
  ): ChatTopic => ({
    id,
    title: id,
    createdAt: updatedAt,
    status,
    updatedAt,
  });

  it('should return empty array for empty input', () => {
    expect(groupTopicsByStatus([], 'updatedAt')).toEqual([]);
  });

  it('should order groups by fixed priority: pending, running, then active', () => {
    const topics = [
      createTopic('a', 'active'),
      createTopic('r', 'running'),
      createTopic('w', 'waitingForHuman'),
    ];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result.map((g) => g.id)).toEqual(['pending', 'running', 'active']);
  });

  it('should collapse waitingForHuman and failed into the pending bucket', () => {
    const topics = [
      createTopic('w', 'waitingForHuman', 2),
      createTopic('f', 'failed', 1),
      createTopic('a', 'active'),
    ];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result.map((g) => g.id)).toEqual(['pending', 'active']);
    expect(result[0].children.map((t) => t.id)).toEqual(['w', 'f']);
  });

  it('should bucket an unread completion as pending while read completions stay completed', () => {
    const topics = [createTopic('unread', 'unread'), createTopic('read', 'completed')];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result.map((g) => g.id)).toEqual(['pending', 'completed']);
    expect(result[0].children.map((t) => t.id)).toEqual(['unread']);
    expect(result[1].children.map((t) => t.id)).toEqual(['read']);
  });

  it('should bucket topics without a status as active', () => {
    const topics = [createTopic('1', undefined), createTopic('2', null)];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('active');
    expect(result[0].children.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('should only emit non-empty groups and keep the remaining states below the priority ones', () => {
    const topics = [
      createTopic('c', 'completed'),
      createTopic('w', 'waitingForHuman'),
      createTopic('p', 'paused'),
    ];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result.map((g) => g.id)).toEqual(['pending', 'paused', 'completed']);
  });

  it('should sort topics inside a group by the chosen field desc', () => {
    const topics = [
      createTopic('old', 'running', 1),
      createTopic('new', 'running', 100),
      createTopic('mid', 'running', 50),
    ];

    const result = groupTopicsByStatus(topics, 'updatedAt');

    expect(result[0].children.map((t) => t.id)).toEqual(['new', 'mid', 'old']);
  });

  it('should bucket a topic that is streaming on this client (loadingTopicIds) as running', () => {
    const topics = [createTopic('loading', 'active'), createTopic('idle', 'active')];

    const result = groupTopicsByStatus(topics, 'updatedAt', new Set(['loading']));

    expect(result.map((g) => g.id)).toEqual(['running', 'active']);
    expect(result[0].children.map((t) => t.id)).toEqual(['loading']);
    expect(result[1].children.map((t) => t.id)).toEqual(['idle']);
  });

  it('should keep a loading topic in pending (it outranks the running overlay)', () => {
    const topics = [createTopic('waiting', 'waitingForHuman')];

    const result = groupTopicsByStatus(topics, 'updatedAt', new Set(['waiting']));

    expect(result.map((g) => g.id)).toEqual(['pending']);
  });
});
