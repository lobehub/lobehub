import {
  getTopicWorkingDirectoryEffectivePath,
  getTopicWorkingDirectorySourcePath,
} from '@lobechat/utils/client/topic';
import dayjs from 'dayjs';

import type { ChatTopic } from '@/types/topic';

import type { SortBy, StatusFilter, TimeRangeFilter, TriggerFilter } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const matchesStatus = (topic: ChatTopic, status: StatusFilter): boolean => {
  switch (status) {
    case 'all': {
      return true;
    }
    case 'archived': {
      return topic.status === 'archived';
    }
    case 'completed': {
      return topic.status === 'completed';
    }
    case 'running': {
      return topic.status === 'running';
    }
    case 'active': {
      return !topic.status || topic.status === 'active';
    }
    default: {
      return true;
    }
  }
};

export const matchesGroup = (topic: ChatTopic, groupIds: string[]): boolean => {
  if (groupIds.length === 0) return true;
  // ChatTopic doesn't surface groupId on the client type; fall back to the
  // working-directory source path as the project bucket key (matches sidebar
  // ByProjectMode). A selected git worktree still belongs to its source repo.
  const project = getTopicWorkingDirectorySourcePath(topic) ?? '';
  return groupIds.includes(project);
};

export const matchesTrigger = (topic: ChatTopic, triggers: TriggerFilter[]): boolean => {
  if (triggers.length === 0) return true;
  const effective: TriggerFilter = (topic.trigger as TriggerFilter | null | undefined) ?? 'chat';
  return triggers.includes(effective);
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

const getPathName = (path: string): string => path.split(/[/\\]+/).findLast(Boolean) ?? path;

export const getProjectFilterLabel = (topic: ChatTopic): string | undefined => {
  const source = getTopicWorkingDirectorySourcePath(topic);
  return source ? getPathName(source) : undefined;
};

export const getProjectLabel = (topic: ChatTopic): string | undefined => {
  const source = getTopicWorkingDirectorySourcePath(topic);
  const effective = getTopicWorkingDirectoryEffectivePath(topic);
  const labelPath = effective ?? source;
  if (!labelPath) return undefined;

  const label = getPathName(labelPath);
  const sourceName = source ? getPathName(source) : undefined;
  const pathLabel = sourceName && sourceName !== label ? `${sourceName}/${label}` : label;
  const branch = topic.metadata?.workingDirectoryConfig?.git?.branch;

  return branch ? `${pathLabel} · ${branch}` : pathLabel;
};

/**
 * Resolve the human-readable title for a time-bucket group ID produced by
 * `groupTopicsByUpdatedTime` (today / yesterday / week / month) or a dynamic
 * year-month / year segment (e.g. `2025-04`, `2024`).
 */
// Accept any react-i18next TFunction shape — overloads make the strict type
// finicky and we only need string → string here.
type LooseT = (key: any) => any;

export const getTimeGroupTitle = (id: string, t: LooseT): string => {
  // Year-month like "2025-04" → localized month name; year-only like "2025" → as-is.
  if (/^\d{4}/.test(id)) {
    return id.includes('-') ? dayjs(id).format('MMMM') : id;
  }
  return t(`groupTitle.byTime.${id}`);
};

/**
 * Resolve the human-readable title for a project-bucket group ID produced by
 * `groupTopicsByProject` (`project:<workingDirectory>` or `no-project`).
 */
export const getProjectGroupTitle = (
  id: string,
  fallback: string | undefined,
  t: LooseT,
): string => {
  if (id === 'no-project') return t('management.group.noProject');
  // Project groups carry the trimmed working-directory name in `group.title`;
  // fall back to the raw path segment if it isn't pre-populated.
  return fallback ?? id.replace(/^project:/, '');
};
