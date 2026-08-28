import type {
  IMNotificationChannelSettings,
  IMPlatformNotificationSettings,
  NotificationChannelSettings,
  NotificationSettings,
} from '@lobechat/types';

/**
 * Merge one channel-settings patch over the stored value, keeping sibling
 * `items` categories and leaves intact.
 */
const mergeChannelSettings = (
  current: NotificationChannelSettings | undefined,
  patch: NotificationChannelSettings,
): NotificationChannelSettings => {
  const mergedItems: Record<string, Record<string, boolean>> = {
    ...current?.items,
    ...patch.items,
  };
  const items = patch.items
    ? Object.fromEntries(
        Object.keys(mergedItems).map((category) => [
          category,
          { ...current?.items?.[category], ...mergedItems[category] },
        ]),
      )
    : current?.items;
  return {
    ...current,
    ...patch,
    ...(items ? { items } : {}),
  };
};

/**
 * The `im` channel nests per-platform channel settings — merge each patched
 * platform with the same channel-level semantics so toggling one platform's
 * switch never wipes that platform's other toggles or its sibling platforms.
 */
const mergeIMSettings = (
  current: IMNotificationChannelSettings | undefined,
  patch: IMNotificationChannelSettings,
): IMNotificationChannelSettings => {
  const platforms = patch.platforms
    ? (Object.fromEntries(
        Object.keys({ ...current?.platforms, ...patch.platforms })
          .map((platform) => {
            const platformPatch = patch.platforms?.[platform];
            return [
              platform,
              platformPatch
                ? mergeChannelSettings(current?.platforms?.[platform], platformPatch)
                : current?.platforms?.[platform],
            ] as const;
          })
          .filter(([, value]) => value !== undefined),
      ) as Record<string, IMPlatformNotificationSettings>)
    : current?.platforms;
  return {
    ...current,
    ...patch,
    ...(platforms ? { platforms } : {}),
  };
};

/**
 * Merge a notification-settings patch over the stored bag without dropping
 * sibling keys: clients patch a single switch at a time (one channel's
 * `enabled`, or one `items[category][type]` leaf), so a shallow replace at
 * any level would wipe the caller's other toggles for that channel.
 *
 * Used by both the server-side `WorkspaceUserSettingsModel.updatePreference`
 * and the client store's optimistic update, so the optimistic cache always
 * matches what the database will keep.
 */
export const mergeNotificationSettings = (
  current: NotificationSettings | undefined,
  patch: NotificationSettings,
): NotificationSettings => {
  const next: NotificationSettings = { ...current };
  for (const [channel, channelPatch] of Object.entries(patch)) {
    if (!channelPatch) continue;
    if (channel === 'im') {
      next.im = mergeIMSettings(next.im, channelPatch as IMNotificationChannelSettings);
      continue;
    }
    const key = channel as keyof Omit<NotificationSettings, 'im'>;
    next[key] = mergeChannelSettings(next[key], channelPatch as NotificationChannelSettings);
  }
  return next;
};
