import type {
  ChatTopic,
  ChatTopicMetadata,
  ChatTopicStatus,
  GroupedTopic,
  TimeGroupId,
} from '@lobechat/types';
import { getWorkingDirEffectivePath, getWorkingDirSourcePath } from '@lobechat/types';
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

// Generic time-based grouping parameterized by field
const groupTopicsByField = (
  topics: ChatTopic[],
  field: 'createdAt' | 'updatedAt',
): GroupedTopic[] => {
  if (!topics.length) return [];

  const sortedTopics = [...topics].sort((a, b) => b[field] - a[field]);
  const groupsMap = new Map<TimeGroupId, ChatTopic[]>();

  for (const topic of sortedTopics) {
    const groupId = getTopicGroupId(topic[field]);
    const existing = groupsMap.get(groupId);
    if (existing) {
      existing.push(topic);
    } else {
      groupsMap.set(groupId, [topic]);
    }
  }

  const result = Array.from(groupsMap.entries()).map(([id, children]) => ({
    children,
    id,
  }));

  return sortGroups(result);
};

export const groupTopicsByTime = (topics: ChatTopic[]) => groupTopicsByField(topics, 'createdAt');
export const groupTopicsByUpdatedTime = (topics: ChatTopic[]) =>
  groupTopicsByField(topics, 'updatedAt');

// Project-based grouping
const NO_PROJECT_GROUP_ID = 'no-project';
const PROJECT_GROUP_PREFIX = 'project:';

// Extract the final path segment as display name; supports POSIX and Windows separators
const getProjectName = (dir: string): string => {
  const segments = dir.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) || dir;
};

const normalizeWorkingDirectory = (dir: string): string => dir.trim().replace(/[/\\]+$/, '');

const normalizeOptionalWorkingDirectory = (dir: string | undefined): string | undefined => {
  if (!dir) return undefined;
  const normalized = normalizeWorkingDirectory(dir);
  return normalized || undefined;
};

export const getTopicMetadataWorkingDirectorySourcePath = (
  metadata?: ChatTopicMetadata,
): string | undefined =>
  normalizeOptionalWorkingDirectory(
    getWorkingDirSourcePath(metadata?.workingDirectoryConfig) ?? metadata?.workingDirectory,
  );

export const getTopicMetadataWorkingDirectoryEffectivePath = (
  metadata?: ChatTopicMetadata,
): string | undefined =>
  normalizeOptionalWorkingDirectory(
    getWorkingDirEffectivePath(metadata?.workingDirectoryConfig) ?? metadata?.workingDirectory,
  );

export const getTopicWorkingDirectorySourcePath = (topic: ChatTopic): string | undefined =>
  getTopicMetadataWorkingDirectorySourcePath(topic.metadata);

export const getTopicWorkingDirectoryEffectivePath = (topic: ChatTopic): string | undefined =>
  getTopicMetadataWorkingDirectoryEffectivePath(topic.metadata);

export const groupTopicsByProject = (
  topics: ChatTopic[],
  field: 'createdAt' | 'updatedAt',
): GroupedTopic[] => {
  if (!topics.length) return [];

  const groupsMap = new Map<string, { children: ChatTopic[]; path: string }>();

  for (const topic of topics) {
    const normalized = getTopicWorkingDirectorySourcePath(topic) ?? '';
    const id = normalized ? `${PROJECT_GROUP_PREFIX}${normalized}` : NO_PROJECT_GROUP_ID;
    const existing = groupsMap.get(id);
    if (existing) {
      existing.children.push(topic);
    } else {
      groupsMap.set(id, { children: [topic], path: normalized });
    }
  }

  // Sort topics inside each group by chosen field desc
  for (const group of groupsMap.values()) {
    group.children.sort((a, b) => b[field] - a[field]);
  }

  const groups: GroupedTopic[] = Array.from(groupsMap.entries()).map(
    ([id, { children, path }]) => ({
      children,
      id,
      title: id === NO_PROJECT_GROUP_ID ? undefined : getProjectName(path),
    }),
  );

  // Most-recently-active project first; "no project" always last
  return groups.sort((a, b) => {
    if (a.id === NO_PROJECT_GROUP_ID) return 1;
    if (b.id === NO_PROJECT_GROUP_ID) return -1;
    const aTime = a.children[0]?.[field] ?? 0;
    const bTime = b.children[0]?.[field] ?? 0;
    return bTime - aTime;
  });
};

// The display buckets for status grouping. These are NOT raw `ChatTopicStatus`
// values: the three states that need the user's attention — awaiting a human,
// failed, and an unread completion — collapse into a single `pending` bucket so
// the sidebar surfaces "needs attention" in one place. The remaining buckets map
// 1:1 to a status. The group `id` resolves its title via `groupTitle.byStatus.<id>`.
export type TopicStatusBucket =
  'pending' | 'running' | 'active' | 'paused' | 'completed' | 'archived';

// Fixed priority order: `pending` (needs attention) comes first, then running,
// then active; the remaining states fall below. Topics without a status are
// treated as `active`.
//
// The server orders the query by the underlying status priority (see
// `STATUS_SORT_RANK` in `@lobechat/database` topic model) so the right page is
// fetched; this only re-buckets that already-ordered page for display. The one
// client-only nuance is `loadingTopicIds` (a topic streaming right now), which
// the server can't know about — see `resolveStatusBucket`. The unread state is
// now a persisted `topics.status === 'unread'`, so it needs no client overlay.
export const STATUS_GROUP_ORDER: TopicStatusBucket[] = [
  'pending',
  'running',
  'active',
  'paused',
  'completed',
  'archived',
];

/**
 * Resolve the bucket a topic belongs to. Mirrors the icon precedence in the
 * sidebar `TopicItem`: anything needing attention (`waitingForHuman`, `failed`,
 * or an unread completion `unread`) lands in `pending`; then a topic actively
 * streaming on this client (`loadingTopicIds`, a transient client-only state the
 * server can't see) or persisted as `running` lands in `running`; then the
 * persisted status, defaulting to `active`.
 */
const resolveStatusBucket = (
  topic: ChatTopic,
  loadingTopicIds?: ReadonlySet<string>,
): TopicStatusBucket => {
  if (topic.status === 'waitingForHuman' || topic.status === 'failed' || topic.status === 'unread')
    return 'pending';
  if (loadingTopicIds?.has(topic.id) || topic.status === 'running') return 'running';
  const status: ChatTopicStatus = topic.status ?? 'active';
  if (status === 'paused' || status === 'completed' || status === 'archived') return status;
  return 'active';
};

export const groupTopicsByStatus = (
  topics: ChatTopic[],
  field: 'createdAt' | 'updatedAt',
  loadingTopicIds?: ReadonlySet<string>,
): GroupedTopic[] => {
  if (!topics.length) return [];

  const groupsMap = new Map<TopicStatusBucket, ChatTopic[]>();

  for (const topic of topics) {
    const id = resolveStatusBucket(topic, loadingTopicIds);
    const existing = groupsMap.get(id);
    if (existing) {
      existing.push(topic);
    } else {
      groupsMap.set(id, [topic]);
    }
  }

  // Sort topics inside each group by chosen field desc
  for (const children of groupsMap.values()) {
    children.sort((a, b) => b[field] - a[field]);
  }

  // Emit only non-empty groups, in the fixed priority order
  return STATUS_GROUP_ORDER.filter((status) => groupsMap.has(status)).map((status) => ({
    children: groupsMap.get(status)!,
    id: status,
  }));
};
