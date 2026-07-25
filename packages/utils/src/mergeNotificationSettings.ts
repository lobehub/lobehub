import type { NotificationSettings } from '@lobechat/types';

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
    const key = channel as keyof NotificationSettings;
    const currentChannel = next[key];
    const mergedItems: Record<string, Record<string, boolean>> = {
      ...currentChannel?.items,
      ...channelPatch.items,
    };
    const items = channelPatch.items
      ? Object.fromEntries(
          Object.keys(mergedItems).map((category) => [
            category,
            { ...currentChannel?.items?.[category], ...mergedItems[category] },
          ]),
        )
      : currentChannel?.items;
    next[key] = {
      ...currentChannel,
      ...channelPatch,
      ...(items ? { items } : {}),
    };
  }
  return next;
};
