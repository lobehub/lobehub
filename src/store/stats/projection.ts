import type { AgentRankItem, ModelRankItem, TopicRankItem } from '@lobechat/types';
import type { HeatmapsProps } from '@lobehub/charts';
import dayjs from 'dayjs';

import { defineReplica } from '@/libs/replica';
import type { usageService } from '@/services/usage';
import type { AgentUsageGranularity, AgentUsageStats } from '@/types/usage/usageRecord';

/** The overview totals on Settings → Stats. */
export type StatsTotalKind = 'agents' | 'messages' | 'topics';

/** A total and its value at the end of last month (the month-over-month baseline). */
export interface StatsTotal {
  count: number;
  prevCount: number;
}

/** The user panel's counters (`DataStatistics`). */
export type StatsCountKind = 'agents' | 'messages' | 'topics';

export interface StatsCount {
  count: number;
  /** Messages only: today's exact delta, shown as "+N". */
  today?: number;
}

export type StatsHeatmapKind = 'messages' | 'tokens';

export type StatsHeatmap = HeatmapsProps['data'];

export interface StatsRankMap {
  agents: AgentRankItem[];
  models: ModelRankItem[];
  topics: TopicRankItem[];
}

export type StatsRankKind = keyof StatsRankMap;

export interface StatsRegistration {
  createdAt: string;
  duration: number;
  updatedAt: string;
}

export type UsageByDay = Awaited<ReturnType<typeof usageService.findAndGroupByDay>>;
export type UsageLogs = Awaited<ReturnType<typeof usageService.findByMonth>>;

export interface AgentUsageParams {
  agentId: string;
  endAt: string;
  granularity: AgentUsageGranularity;
  startAt: string;
}

/** The only entry of a resource that answers one parameterless read. */
export const SINGLE_KEY = 'self';

/**
 * Every stats read is persisted to IndexedDB under the replica's user +
 * workspace scope, so Settings → Stats, the user panel and an agent's usage tab
 * paint the last numbers on reload and revalidate in the background.
 */
export const statsTotalResource = defineReplica<StatsTotalKind, StatsTotal>({
  key: (kind) => kind,
  name: 'statsTotal',
  storage: 'indexedDB',
  version: 1,
});

export const statsCountResource = defineReplica<StatsCountKind, StatsCount>({
  key: (kind) => kind,
  name: 'statsCount',
  storage: 'indexedDB',
  version: 1,
});

/** A year of daily cells per heatmap. */
export const statsHeatmapResource = defineReplica<StatsHeatmapKind, StatsHeatmap>({
  key: (kind) => kind,
  name: 'statsHeatmap',
  storage: 'indexedDB',
  version: 1,
});

export const statsRankResource = defineReplica<StatsRankKind, StatsRankMap[StatsRankKind]>({
  key: (kind) => kind,
  name: 'statsRank',
  storage: 'indexedDB',
  version: 1,
});

export const statsRegistrationResource = defineReplica<typeof SINGLE_KEY, StatsRegistration>({
  key: () => SINGLE_KEY,
  name: 'statsRegistration',
  storage: 'indexedDB',
  version: 1,
});

export const statsMaxTaskDurationResource = defineReplica<typeof SINGLE_KEY, number>({
  key: () => SINGLE_KEY,
  name: 'statsMaxTaskDuration',
  storage: 'indexedDB',
  version: 1,
});

/**
 * Month key (`YYYY-MM`). No picked month means this calendar month, read by
 * its own key: a fixed "current" key would paint last month's persisted usage
 * under this month's picker after a month rolls over.
 */
export const usageMonthKey = (month?: string): string => month || dayjs().format('YYYY-MM');

/** Daily usage of one month — the usage cards and trend chart. */
export const usageByDayResource = defineReplica<string, UsageByDay>({
  key: (month) => month,
  name: 'usageByDay',
  persist: { maxEntries: 6 },
  storage: 'indexedDB',
  version: 1,
});

/**
 * Every usage record of one month (the usage table). One row per model call,
 * so a busy month is large: only the last two months viewed survive a reload.
 */
export const usageLogsResource = defineReplica<string, UsageLogs>({
  key: (month) => month,
  name: 'usageLogs',
  persist: { maxEntries: 2 },
  storage: 'indexedDB',
  version: 1,
});

export const agentUsageKey = ({ agentId, endAt, granularity, startAt }: AgentUsageParams) =>
  [agentId, startAt, endAt, granularity].join('|');

/** One agent's usage + cost over a date range (the agent's usage tab). */
export const agentUsageResource = defineReplica<AgentUsageParams, AgentUsageStats>({
  key: agentUsageKey,
  name: 'agentUsage',
  persist: { maxEntries: 20 },
  storage: 'indexedDB',
  version: 1,
});
