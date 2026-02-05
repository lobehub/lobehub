import type { ChatTopic } from '@lobechat/types';
import dayjs from 'dayjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { groupTopicsByTime } from './topic';

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
