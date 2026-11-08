export type ChannelSettingsTab = 'advanced' | 'general' | 'members' | 'reply';

/** An archived Channel takes no writes until it is reopened, so its replies cannot be edited. */
export const channelSettingsTabs = (archived: boolean): ChannelSettingsTab[] =>
  archived ? ['general', 'members', 'advanced'] : ['general', 'members', 'reply', 'advanced'];

/** The `?tab=` of a shared link, or the first tab when it is missing or not available here. */
export const resolveChannelSettingsTab = (
  requested: string | null,
  tabs: ChannelSettingsTab[],
): ChannelSettingsTab => tabs.find((tab) => tab === requested) ?? tabs[0];
