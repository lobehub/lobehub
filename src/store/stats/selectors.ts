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
 * The heatmap once it can be shown as is: a restored empty year may predate the
 * user's first message, so it stays `undefined` (loading, or the fetch error)
 * until this session's server answer confirms it.
 */
const settledHeatmap =
  (kind: StatsHeatmapKind) =>
  (s: StatsState): StatsHeatmap | undefined => {
    const data = s.heatmapMap[kind];
    if (!data || data.length > 0) return data;
    return s.heatmapReplica.entries[kind]?.source === 'server' ? data : undefined;
  };

const rank =
  <K extends StatsRankKind>(kind: K) =>
  (s: StatsState): StatsRankMap[K] | undefined =>
    s.rankMap[kind] as StatsRankMap[K] | undefined;

/**
 * The ranking once it can be shown as is: a restored empty ranking predates any
 * activity since, so it stays `undefined` (loading, or the fetch error) until
 * this session's server answer confirms it.
 */
const settledRank =
  <K extends StatsRankKind>(kind: K) =>
  (s: StatsState): StatsRankMap[K] | undefined => {
    const data = rank(kind)(s);
    if (!data || data.length > 0) return data;
    return s.rankReplica.entries[kind]?.source === 'server' ? data : undefined;
  };

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

/** Same as `settledHeatmap`: a restored empty month is not "no usage" until the server says so. */
const settledUsageLogs =
  (month?: string) =>
  (s: StatsState): UsageLogs | undefined => {
    const key = usageMonthKey(month);
    const data = s.usageLogsMap[key];
    if (!data || data.length > 0) return data;
    return s.usageLogsReplica.entries[key]?.source === 'server' ? data : undefined;
  };

const agentUsage =
  (params: AgentUsageParams | null) =>
  (s: StatsState): AgentUsageStats | undefined =>
    params ? s.agentUsageMap[agentUsageKey(params)] : undefined;

export const statsSelectors = {
  agentUsage,
  count,
  heatmap,
  maxTaskDuration,
  rank,
  settledHeatmap,
  settledRank,
  settledUsageLogs,
  registration,
  total,
  usageByDay,
  usageLogs,
};
