export type ViewMode = 'card' | 'list';

export type StatusFilter = 'all' | 'active' | 'running' | 'completed' | 'archived';

export type TriggerFilter = 'chat' | 'api' | 'task' | 'eval' | 'bot';

export type TimeRangeFilter = 'all' | 'today' | 'week' | 'month';

export type SortBy = 'updatedAt' | 'createdAt' | 'title';

export type GroupBy = 'byProject' | 'byTime' | 'none';

/**
 * A bot source platform, identified by `topic.metadata.bot.platform`
 * (e.g. `discord` / `telegram`). One value selects topics that arrived
 * through any channel of that platform's bot.
 */
export type BotChannelFilter = string;

/** One selectable bot source platform inside the flattened channel menu. */
export interface BotChannelOption {
  /** Platform id, e.g. `discord` — the filter value. */
  key: string;
  /** Display label, e.g. `Discord` / `Telegram`. */
  label: string;
}
