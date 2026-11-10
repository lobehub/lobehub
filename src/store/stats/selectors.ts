import type { AgentUsageStats } from '@/types/usage/usageRecord';

import type { StatsState } from './initialState';
import {
  agentUsageKey,
  type AgentUsageParams,
  SINGLE_KEY,
  type StatsCount,
  type StatsCountKind,
  type StatsHeatmap,
  type StatsHeatmapKind,
  type StatsRankKind,
  type StatsRankMap,
  type StatsRegistration,
  type StatsTotal,
  type StatsTotalKind,
  type UsageByDay,
  type UsageLogs,
  usageMonthKey,
} from './projection';

/** Each read is `undefined` until the local copy or the server fills it. */
const total =
  (kind: StatsTotalKind) =>
  (s: StatsState): StatsTotal | undefined =>
    s.totalMap[kind];

const count =
  (kind: StatsCountKind) =>
  (s: StatsState): StatsCount | undefined =>
    s.countMap[kind];

const heatmap =
  (kind: StatsHeatmapKind) =>
  (s: StatsState): StatsHeatmap | undefined =>
    s.heatmapMap[kind];

/**
 * A restored heatmap may be an empty snapshot from before the user's first
 * message; it only reads as "no activity" once this session's server answer
 * says so.
 */
const isHeatmapConfirmed =
  (kind: StatsHeatmapKind) =>
  (s: StatsState): boolean =>
    s.heatmapReplica.entries[kind]?.source === 'server';

const rank =
  <K extends StatsRankKind>(kind: K) =>
  (s: StatsState): StatsRankMap[K] | undefined =>
    s.rankMap[kind] as StatsRankMap[K] | undefined;

/** Same as `isHeatmapConfirmed`: an empty restored ranking is not an empty state yet. */
const isRankConfirmed =
  (kind: StatsRankKind) =>
  (s: StatsState): boolean =>
    s.rankReplica.entries[kind]?.source === 'server';

const registration = (s: StatsState): StatsRegistration | undefined =>
  s.registrationMap[SINGLE_KEY];

const maxTaskDuration = (s: StatsState): number | undefined => s.maxTaskDurationMap[SINGLE_KEY];

const usageByDay =
  (month?: string) =>
  (s: StatsState): UsageByDay | undefined =>
    s.usageByDayMap[usageMonthKey(month)];

const usageLogs =
  (month?: string) =>
  (s: StatsState): UsageLogs | undefined =>
    s.usageLogsMap[usageMonthKey(month)];

/** A restored empty table is not "no usage this month" until the server confirms it. */
const isUsageLogsConfirmed =
  (month?: string) =>
  (s: StatsState): boolean =>
    s.usageLogsReplica.entries[usageMonthKey(month)]?.source === 'server';

const agentUsage =
  (params: AgentUsageParams | null) =>
  (s: StatsState): AgentUsageStats | undefined =>
    params ? s.agentUsageMap[agentUsageKey(params)] : undefined;

export const statsSelectors = {
  agentUsage,
  count,
  heatmap,
  isHeatmapConfirmed,
  isRankConfirmed,
  isUsageLogsConfirmed,
  maxTaskDuration,
  rank,
  registration,
  total,
  usageByDay,
  usageLogs,
};
