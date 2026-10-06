import type { AcceptanceStatus } from '@lobechat/types';
import dayjs from 'dayjs';

import type { AcceptanceListItem } from '@/services/verify';

/** How the panel sections its rows. Persisted per user. */
export type AcceptanceGroupMode = 'none' | 'project' | 'status' | 'time';

export const DEFAULT_ACCEPTANCE_GROUP_MODE: AcceptanceGroupMode = 'project';

export const normalizeAcceptanceGroupMode = (value: unknown): AcceptanceGroupMode =>
  value === 'none' || value === 'status' || value === 'time'
    ? value
    : DEFAULT_ACCEPTANCE_GROUP_MODE;

export interface AcceptanceListGroup {
  items: AcceptanceListItem[];
  key: string;
  /** i18n key under `verify:acceptance.workspace.groups.*` for a fixed bucket. */
  labelKey: string | null;
  /**
   * Header text that comes from the data itself (a project's name). Fixed
   * buckets carry a `labelKey` instead, so the panel never has to translate a
   * user's project name or hardcode a bucket's wording.
   */
  name: string | null;
  projectName: string | null;
}

const UNGROUPED_KEY = 'ungrouped';

/**
 * Status buckets, in the order a reviewer works down them: what is still moving,
 * what is waiting on them, what they sent back, then the settled tail.
 */
const STATUS_BUCKETS = ['running', 'review', 'rejected', 'accepted', 'closed'] as const;
type StatusBucket = (typeof STATUS_BUCKETS)[number];

const statusBucketOf = (status: AcceptanceStatus): StatusBucket => {
  if (status === 'pending' || status === 'planned' || status === 'verifying') return 'running';
  if (status === 'repairing') return 'running';
  if (status === 'rejected') return 'rejected';
  if (status === 'accepted') return 'accepted';
  if (status === 'closed') return 'closed';
  // delivered / failed / errored — a verdict is in and the reviewer owns it.
  return 'review';
};

/**
 * Age buckets. Cut on `createdAt`, which is also the feed's sort AND paging key:
 * bucketing on last-activity instead would leave a "today" section that stays
 * incomplete until the whole month has been scrolled in, because a row touched
 * today can be paged in arbitrarily late.
 *
 * Spans are rolling ("last 7 days"), not calendar weeks — a Monday must not
 * put everything from Sunday under "earlier".
 */
const TIME_BUCKETS = ['today', 'yesterday', 'week', 'month', 'earlier'] as const;
type TimeBucket = (typeof TIME_BUCKETS)[number];

const timeBucketOf = (createdAt: Date | string, now: number): TimeBucket => {
  const created = dayjs(createdAt);
  const startOfToday = dayjs(now).startOf('day');
  if (!created.isBefore(startOfToday)) return 'today';
  if (!created.isBefore(startOfToday.subtract(1, 'day'))) return 'yesterday';
  if (!created.isBefore(startOfToday.subtract(7, 'day'))) return 'week';
  if (!created.isBefore(startOfToday.subtract(30, 'day'))) return 'month';
  return 'earlier';
};

const emptyGroup = (key: string, labelKey: string): AcceptanceListGroup => ({
  items: [],
  key,
  labelKey,
  name: null,
  projectName: null,
});

/** Fixed buckets keep their declared order and drop the ones nothing landed in. */
const collectFixedBuckets = <B extends string>(
  order: readonly B[],
  labelKeyOf: (bucket: B) => string,
  items: AcceptanceListItem[],
  bucketOf: (item: AcceptanceListItem) => B,
): AcceptanceListGroup[] => {
  const byBucket = new Map<B, AcceptanceListGroup>(
    order.map((bucket) => [bucket, emptyGroup(bucket, labelKeyOf(bucket))]),
  );
  for (const item of items) byBucket.get(bucketOf(item))!.items.push(item);
  return order.map((bucket) => byBucket.get(bucket)!).filter((group) => group.items.length > 0);
};

const groupByProject = (items: AcceptanceListItem[]): AcceptanceListGroup[] => {
  const groups = new Map<string, AcceptanceListGroup>();

  for (const item of items) {
    const key = item.project?.id ?? UNGROUPED_KEY;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      items: [item],
      key,
      labelKey: item.project ? null : 'acceptance.workspace.groups.ungrouped',
      name: item.project?.name ?? null,
      projectName: item.project?.name ?? null,
    });
  }

  return [...groups.values()].sort((a, b) => {
    if (!a.projectName) return 1;
    if (!b.projectName) return -1;
    return a.projectName.localeCompare(b.projectName);
  });
};

export const groupAcceptanceList = (
  items: AcceptanceListItem[],
  mode: AcceptanceGroupMode = 'project',
  now: number = Date.now(),
): AcceptanceListGroup[] => {
  if (mode === 'none') return [];
  if (mode === 'project') return groupByProject(items);
  if (mode === 'status')
    return collectFixedBuckets(
      STATUS_BUCKETS,
      (bucket) => `acceptance.workspace.groups.status.${bucket}`,
      items,
      (item) => statusBucketOf(item.status as AcceptanceStatus),
    );
  return collectFixedBuckets(
    TIME_BUCKETS,
    (bucket) => `acceptance.workspace.groups.time.${bucket}`,
    items,
    (item) => timeBucketOf(item.createdAt, now),
  );
};

export const hasProjectAcceptanceGroups = (groups: AcceptanceListGroup[]) =>
  groups.some(({ projectName }) => projectName !== null);

/**
 * Whether sectioning earns its chrome.
 *
 * `project` is the one mode that can degrade to a single bucket — a user with no
 * projects would get one "Ungrouped" accordion wrapping the whole list, which is
 * a header that says nothing. The explicit modes always section.
 */
export const shouldRenderAcceptanceGroups = (
  mode: AcceptanceGroupMode,
  groups: AcceptanceListGroup[],
) => {
  if (mode === 'none' || groups.length === 0) return false;
  if (mode === 'project') return hasProjectAcceptanceGroups(groups);
  return true;
};

/**
 * Which groups the accordion shows open. Expressed as "everything except what
 * the user collapsed" on purpose: a group that appears AFTER mount — the one
 * the user just filed a delivery into, or the bucket the next scroll page opens
 * — must be open, or the rows that landed in it silently disappear behind a
 * collapsed header.
 */
export const expandedAcceptanceGroupKeys = (
  groups: AcceptanceListGroup[],
  collapsedKeys: string[],
) => groups.map(({ key }) => key).filter((key) => !collapsedKeys.includes(key));

/**
 * Fold an accordion change back into the collapsed set.
 *
 * Only the groups the list is currently showing can be reported by the
 * accordion, so a group hidden behind the active filter/search keeps whatever
 * the user last chose for it. Rebuilding the set from the visible groups alone
 * would silently re-open it the moment the filter is cleared.
 */
export const nextCollapsedGroupKeys = (
  previousCollapsed: string[],
  groups: AcceptanceListGroup[],
  expandedKeys: string[],
) => {
  const visible = new Set(groups.map(({ key }) => key));
  const expanded = new Set(expandedKeys);

  return [
    ...previousCollapsed.filter((key) => !visible.has(key)),
    ...groups.map(({ key }) => key).filter((key) => !expanded.has(key)),
  ];
};
