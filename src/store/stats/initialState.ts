import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { AgentUsageStats } from '@/types/usage/usageRecord';

import type {
  StatsCount,
  StatsHeatmap,
  StatsRankKind,
  StatsRankMap,
  StatsRegistration,
  StatsTotal,
  UsageByDay,
  UsageLogs,
} from './projection';

export interface StatsState {
  /** One agent's usage per `agentUsageKey` (replica view). */
  agentUsageMap: Record<string, AgentUsageStats>;
  agentUsageReplica: ReplicaState<AgentUsageStats>;
  /** User panel counters per `StatsCountKind` (replica view). */
  countMap: Record<string, StatsCount>;
  countReplica: ReplicaState<StatsCount>;
  /** Daily activity cells per `StatsHeatmapKind` (replica view). */
  heatmapMap: Record<string, StatsHeatmap>;
  heatmapReplica: ReplicaState<StatsHeatmap>;
  /** Longest task duration (ms) under `SINGLE_KEY` (replica view). */
  maxTaskDurationMap: Record<string, number>;
  maxTaskDurationReplica: ReplicaState<number>;
  /** Top agents / models / topics per `StatsRankKind` (replica view). */
  rankMap: Partial<StatsRankMap>;
  rankReplica: ReplicaState<StatsRankMap[StatsRankKind]>;
  /** Account age under `SINGLE_KEY` (replica view). */
  registrationMap: Record<string, StatsRegistration>;
  registrationReplica: ReplicaState<StatsRegistration>;
  /** Overview totals per `StatsTotalKind` (replica view). */
  totalMap: Record<string, StatsTotal>;
  totalReplica: ReplicaState<StatsTotal>;
  /** Daily usage per month key (replica view). */
  usageByDayMap: Record<string, UsageByDay>;
  usageByDayReplica: ReplicaState<UsageByDay>;
  /** Usage records per month key (replica view). */
  usageLogsMap: Record<string, UsageLogs>;
  usageLogsReplica: ReplicaState<UsageLogs>;
}

export const initialState: StatsState = {
  agentUsageMap: {},
  agentUsageReplica: createReplicaState(),
  countMap: {},
  countReplica: createReplicaState(),
  heatmapMap: {},
  heatmapReplica: createReplicaState(),
  maxTaskDurationMap: {},
  maxTaskDurationReplica: createReplicaState(),
  rankMap: {},
  rankReplica: createReplicaState(),
  registrationMap: {},
  registrationReplica: createReplicaState(),
  totalMap: {},
  totalReplica: createReplicaState(),
  usageByDayMap: {},
  usageByDayReplica: createReplicaState(),
  usageLogsMap: {},
  usageLogsReplica: createReplicaState(),
};
