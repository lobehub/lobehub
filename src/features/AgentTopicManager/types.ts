export type ViewMode = 'card' | 'list';

export type StatusFilter = 'all' | 'active' | 'running' | 'completed' | 'archived';

export type TriggerFilter = 'chat' | 'api' | 'task' | 'eval';

export type TimeRangeFilter = 'all' | 'today' | 'week' | 'month';

export type SortBy = 'updatedAt' | 'createdAt' | 'title';

export type GroupBy = 'byProject' | 'byTime' | 'none';

/**
 * A bot-source channel, identified by `topic.metadata.bot.platformThreadId`
 * (e.g. `discord:guild:channel:thread`). One value selects topics that came
 * from one bot's channel on one platform.
 */
export type BotChannelFilter = string;

/** One selectable bot-source channel inside a bot group. */
export interface BotChannelOption {
  /** bot application id, e.g. the platform app/bot id. */
  applicationId: string;
  /** `platformThreadId` — the filter value. */
  key: string;
  /** Display label for the channel (short-id fallback). */
  label: string;
  /** Platform id, e.g. `discord`. */
  platform: string;
}

/** A bot (platform + application) owning a set of channels. */
export interface BotChannelGroup {
  channels: BotChannelOption[];
  /** `${platform}:${applicationId}` — one bot install. */
  key: string;
  /** Display label for the bot (platform name fallback). */
  label: string;
  /** Platform id, e.g. `discord`. */
  platform: string;
}
