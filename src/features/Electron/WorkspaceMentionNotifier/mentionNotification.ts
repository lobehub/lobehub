import type { ShowDesktopNotificationParams } from '@lobechat/electron-client-ipc';

import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { markdownToTxt } from '@/utils/markdownToTxt';

/** The inbox row fields the mention banner reads. */
export interface MentionNotificationRow {
  actionUrl?: string | null;
  content: string;
  context?: string | null;
  id: string;
  title: string;
}

/** Cap the banner body so a long comment doesn't overflow the OS notification. */
const NOTIFICATION_BODY_MAX_LENGTH = 256;
/** At most this many banners per poll, so a burst of mentions doesn't flood the OS tray. */
export const MAX_MENTION_BANNERS_PER_POLL = 3;
/** Bound the per-workspace seen set; far above the page size the watcher polls. */
const MAX_SEEN_IDS = 500;

export interface PickNewMentionsResult {
  /** Rows to announce, oldest first. */
  fresh: MentionNotificationRow[];
  seen: Set<string>;
}

/**
 * Diff the latest unread-mention page (newest first) against the ids already
 * seen in this workspace. The first page a workspace returns is a baseline:
 * mentions that were already waiting in the inbox are not replayed as banners.
 */
export const pickNewMentions = (
  rows: MentionNotificationRow[],
  seen: Set<string> | undefined,
): PickNewMentionsResult => {
  const nextSeen = new Set(seen);
  for (const row of rows) nextSeen.add(row.id);

  // Sets iterate in insertion order, so trimming from the front drops the oldest ids.
  for (const id of nextSeen) {
    if (nextSeen.size <= MAX_SEEN_IDS) break;
    nextSeen.delete(id);
  }

  if (!seen) return { fresh: [], seen: nextSeen };

  const fresh = rows
    .filter((row) => !seen.has(row.id))
    .slice(0, MAX_MENTION_BANNERS_PER_POLL)
    .reverse();

  return { fresh, seen: nextSeen };
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
 * to the inbox since the banner can only drive SPA navigation.
 */
const buildNavigate = (
  actionUrl: string | null | undefined,
  workspaceSlug: string | null,
): ShowDesktopNotificationParams['navigate'] => {
  if (!actionUrl?.startsWith('/')) return undefined;

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
