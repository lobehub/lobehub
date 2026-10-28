import { useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useSingleton } from '@/hooks/useSingleton';
import { useClientPollingSWR } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { desktopNotificationService } from '@/services/electron/desktopNotification';
import { notificationService } from '@/services/notification';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import {
  MAX_MENTION_BANNERS_PER_POLL,
  type MentionNotificationRow,
  type MentionWatermark,
  pickNewMentions,
  toMentionNotificationParams,
} from './mentionNotification';

export const MENTION_POLL_INTERVAL = 30_000;
/** Page size: comfortably above the per-poll banner cap so a burst is still diffed whole. */
const MENTION_PAGE_SIZE = MAX_MENTION_BANNERS_PER_POLL * 5;

/**
 * Raises an OS notification when another workspace member @-mentions the user.
 *
 * Mentions land in the active workspace's inbox under the `mention` category;
 * this polls the unread ones and announces each one created after the newest
 * mention it has already seen.
 * The main process decides whether to show the banner (only while the window
 * is hidden or unfocused), so a user already looking at the app is not pinged
 * twice — the inbox bell still carries the mention.
 */
export const useWorkspaceMentionNotifier = (): void => {
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const isLogin = useUserStore(authSelectors.isLogin);
  const workspaceId = useActiveWorkspaceId();
  const enabled = enableBusinessFeatures && isLogin === true && !!workspaceId;

  // Per workspace, so switching away and back doesn't re-announce old mentions.
  const watermarkByWorkspace = useSingleton(() => new Map<string, MentionWatermark>());

  const { data } = useClientPollingSWR<MentionNotificationRow[]>(
    enabled ? inboxKeys.unreadMentions(workspaceId) : null,
    () =>
      notificationService.list({ category: 'mention', isRead: false, limit: MENTION_PAGE_SIZE }),
    {
      dedupingInterval: MENTION_POLL_INTERVAL / 2,
      refreshInterval: MENTION_POLL_INTERVAL,
      // The banner matters most while the window is minimized or in the background.
      refreshWhenHidden: true,
    },
  );

  useEffect(() => {
    if (!data || !workspaceId) return;

    const { fresh, watermark } = pickNewMentions(data, watermarkByWorkspace.get(workspaceId));
    watermarkByWorkspace.set(workspaceId, watermark);
    if (fresh.length === 0) return;

    const workspaceSlug = getActiveWorkspaceSlug();
    for (const row of fresh) {
      desktopNotificationService
        .showNotification(toMentionNotificationParams(row, workspaceSlug))
        .catch((error) => console.error('Workspace mention desktop notification failed:', error));
    }
  }, [data, watermarkByWorkspace, workspaceId]);
};
