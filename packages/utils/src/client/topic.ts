import type { ChatTopic, GroupedTopic, TimeGroupId } from '@lobechat/types';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';

// Initialize dayjs plugins
dayjs.extend(isToday);
dayjs.extend(isYesterday);

const getTopicGroupId = (timestamp: number): TimeGroupId => {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isToday()) {
    return 'today';
  }

  if (date.isYesterday()) {
    return 'yesterday';
  }

  // Within 7 days (excluding today and yesterday)
  const weekAgo = now.subtract(7, 'day');
  if (date.isAfter(weekAgo) && !date.isToday() && !date.isYesterday()) {
    return 'week';
  }

  // Current month (excluding dates already grouped above)
  // Use native month and year comparison
  if (date.month() === now.month() && date.year() === now.year()) {
    return 'month';
  }

  // Other months of the current year
  if (date.year() === now.year()) {
    return `${date.year()}-${(date.month() + 1).toString().padStart(2, '0')}`;
  }

  // Earlier years
  return `${date.year()}`;
};

// Ensure group sorting
const sortGroups = (groups: GroupedTopic[]): GroupedTopic[] => {
  const orderMap = new Map<string, number>([
    ['today', 0],
    ['yesterday', 1],
    ['week', 2],
    ['month', 3],
  ]);

  // Set the order of fixed groups

  return groups.sort((a, b) => {
    const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;

    if (orderA !== Number.MAX_SAFE_INTEGER || orderB !== Number.MAX_SAFE_INTEGER) {
      return orderA - orderB;
    }

    // For year-month and year format groups, sort in descending chronological order
    return b.id.localeCompare(a.id);
  });
};

// Specific implementation of time grouping
export const groupTopicsByTime = (topics: ChatTopic[]): GroupedTopic[] => {
  if (!topics.length) return [];

  const sortedTopics = [...topics].sort((a, b) => b.createdAt - a.createdAt);
  const groupsMap = new Map<TimeGroupId, ChatTopic[]>();

  sortedTopics.forEach((topic) => {
    const groupId = getTopicGroupId(topic.createdAt);
    const existingGroup = groupsMap.get(groupId) || [];
    groupsMap.set(groupId, [...existingGroup, topic]);
  });

  const result = Array.from(groupsMap.entries()).map(([id, children]) => ({
    children,
    id,
  }));

  return sortGroups(result);
};
