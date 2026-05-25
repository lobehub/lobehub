export type ViewMode = 'card' | 'list';

export type StatusFilter = 'all' | 'active' | 'running' | 'completed' | 'archived';

export type TriggerFilter = 'chat' | 'api' | 'cron' | 'eval';

export type TimeRangeFilter = 'all' | 'today' | 'week' | 'month';

export type SortBy = 'updatedAt' | 'createdAt' | 'title';

export type GroupBy = 'byProject' | 'byTime' | 'none';
