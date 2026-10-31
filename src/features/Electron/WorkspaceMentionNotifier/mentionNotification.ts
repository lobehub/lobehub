import type { ShowDesktopNotificationParams } from '@lobechat/electron-client-ipc';

import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { markdownToTxt } from '@/utils/markdownToTxt';
import { isSafeRedirectPath } from '@/utils/onboardingRedirect';

/** The inbox row fields the mention banner reads. */
export interface MentionNotificationRow {
  actionUrl?: string | null;
  content: string;
  context?: string | null;
  createdAt: Date;
  id: string;
  title: string;
}

/** Cap the banner body so a long comment doesn't overflow the OS notification. */
const NOTIFICATION_BODY_MAX_LENGTH = 256;
/** At most this many banners per poll, so a burst of mentions doesn't flood the OS tray. */
export const MAX_MENTION_BANNERS_PER_POLL = 3;

/**
 * The newest mention a workspace has seen. Only rows created after it are new;
 * `ids` breaks ties between rows that share its exact timestamp.
 */
export interface MentionWatermark {
  createdAt: number;
  ids: Set<string>;
}

export interface PickNewMentionsResult {
  /** Rows to announce, oldest first. */
  fresh: MentionNotificationRow[];
  watermark: MentionWatermark;
}

const isAfter = (row: MentionNotificationRow, watermark: MentionWatermark): boolean => {
  const createdAt = row.createdAt.getTime();
  return (
    createdAt > watermark.createdAt ||
    (createdAt === watermark.createdAt && !watermark.ids.has(row.id))
  );
};

const advanceWatermark = (
  rows: MentionNotificationRow[],
  watermark: MentionWatermark | undefined,
): MentionWatermark => {
  // An empty baseline page still counts: any mention after it is new.
  let next = { createdAt: watermark?.createdAt ?? -Infinity, ids: new Set(watermark?.ids) };
  for (const row of rows) {
    const createdAt = row.createdAt.getTime();
    if (createdAt > next.createdAt) next = { createdAt, ids: new Set([row.id]) };
    else if (createdAt === next.createdAt) next.ids.add(row.id);
  }
  return next;
};

/**
 * Diff the latest unread-mention page (newest first) against the newest
 * mention already seen in this workspace. The first page a workspace returns
 * is a baseline: mentions that were already waiting in the inbox are not
 * replayed as banners. Comparing by creation time rather than by id keeps
 * older unread mentions that only scroll into the page — once newer ones are
 * read or archived — from being announced as if they had just arrived.
 */
export const pickNewMentions = (
  rows: MentionNotificationRow[],
  watermark: MentionWatermark | undefined,
): PickNewMentionsResult => {
  const nextWatermark = advanceWatermark(rows, watermark);
  if (!watermark) return { fresh: [], watermark: nextWatermark };

  const fresh = rows
    .filter((row) => isAfter(row, watermark))
    .slice(0, MAX_MENTION_BANNERS_PER_POLL)
    .reverse();

  return { fresh, watermark: nextWatermark };
};

const buildBody = (row: MentionNotificationRow): string => {
  const text = markdownToTxt(row.content).trim() || row.context?.trim() || '';
  return text.length > NOTIFICATION_BODY_MAX_LENGTH
    ? `${text.slice(0, NOTIFICATION_BODY_MAX_LENGTH)}…`
    : text;
};

/**
 * Resolve the banner click target the same way the inbox does: in-app paths
 * get the workspace prefix (pinned to the workspace the mention belongs to, so
 * a later workspace switch can't redirect the click), external URLs are left
 * to the inbox since the banner can only drive SPA navigation. Protocol-relative
 * (`//host`) and backslash paths are rejected so a row can't steer the click
 * off-origin.
 */
const buildNavigate = (
  actionUrl: string | null | undefined,
  workspaceSlug: string | null,
): ShowDesktopNotificationParams['navigate'] => {
  if (!actionUrl || !isSafeRedirectPath(actionUrl)) return undefined;

  return { escape: true, path: buildWorkspaceAwarePath(actionUrl, workspaceSlug) };
};

export const toMentionNotificationParams = (
  row: MentionNotificationRow,
  workspaceSlug: string | null,
): ShowDesktopNotificationParams => ({
  body: buildBody(row),
  navigate: buildNavigate(row.actionUrl, workspaceSlug),
  title: row.title,
});
