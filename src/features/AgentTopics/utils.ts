import type { ChatTopic } from '@/types/topic';

import type { SortBy, StatusFilter, TimeRangeFilter, TriggerFilter } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const matchesStatus = (topic: ChatTopic, status: StatusFilter): boolean => {
  switch (status) {
    case 'all': {
      return true;
    }
    case 'favorite': {
      return !!topic.favorite;
    }
    case 'archived': {
      return topic.status === 'archived';
    }
    case 'completed': {
      return topic.status === 'completed';
    }
    case 'active': {
      return !topic.status || topic.status === 'active' || topic.status === 'running';
    }
    default: {
      return true;
    }
  }
};

export const matchesGroup = (topic: ChatTopic, groupIds: string[]): boolean => {
  if (groupIds.length === 0) return true;
  // ChatTopic doesn't surface groupId on the client type; fall back to metadata.workingDirectory
  // as the project bucket key (matches sidebar ByProjectMode).
  const project = topic.metadata?.workingDirectory ?? '';
  return groupIds.includes(project);
};

export const matchesTrigger = (topic: ChatTopic, triggers: TriggerFilter[]): boolean => {
  if (triggers.length === 0) return true;
  const t = (topic.trigger ?? 'chat') as TriggerFilter;
  return triggers.includes(t);
};

export const matchesTimeRange = (topic: ChatTopic, range: TimeRangeFilter): boolean => {
  if (range === 'all') return true;
  const updated = topic.updatedAt ? new Date(topic.updatedAt).getTime() : 0;
  if (!updated) return false;
  const now = Date.now();
  const diff = now - updated;
  switch (range) {
    case 'today': {
      return diff < DAY_MS;
    }
    case 'week': {
      return diff < 7 * DAY_MS;
    }
    case 'month': {
      return diff < 30 * DAY_MS;
    }
    default: {
      return true;
    }
  }
};

export const sortTopics = (topics: ChatTopic[], sortBy: SortBy): ChatTopic[] => {
  const sorted = [...topics];
  switch (sortBy) {
    case 'updatedAt': {
      sorted.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      );
      break;
    }
    case 'createdAt': {
      sorted.sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
      break;
    }
    case 'title': {
      sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
      break;
    }
  }
  return sorted;
};

export const formatRelativeTime = (date: Date | number | string | undefined | null): string => {
  if (!date) return '';
  const time = typeof date === 'number' ? date : new Date(date).getTime();
  if (Number.isNaN(time)) return '';
  const diff = Date.now() - time;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (sec < 60) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (hour < 24) return `${hour}h ago`;
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
};

export const getProjectLabel = (topic: ChatTopic): string | undefined => {
  const wd = topic.metadata?.workingDirectory;
  if (!wd) return undefined;
  // Show last segment of path for readability
  const parts = wd.split('/').filter(Boolean);
  return parts.at(-1) ?? wd;
};
