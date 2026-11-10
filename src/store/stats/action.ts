import { cacheScope, createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { agentService } from '@/services/agent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { usageService } from '@/services/usage';
import { userService } from '@/services/user';
import type { StoreSetter } from '@/store/types';
import type { AgentUsageStats } from '@/types/usage/usageRecord';
import { setNamespace } from '@/utils/storeDebug';
import { lastMonth, today } from '@/utils/time';

import { initialState, type StatsState } from './initialState';
import {
  type AgentUsageParams,
  agentUsageResource,
  SINGLE_KEY,
  type StatsCount,
  type StatsCountKind,
  statsCountResource,
  type StatsHeatmap,
  type StatsHeatmapKind,
  statsHeatmapResource,
  statsMaxTaskDurationResource,
  type StatsRankKind,
  type StatsRankMap,
  statsRankResource,
  type StatsRegistration,
  statsRegistrationResource,
  type StatsTotal,
  type StatsTotalKind,
  statsTotalResource,
  type UsageByDay,
  usageByDayResource,
  type UsageLogs,
  usageLogsResource,
  usageMonthKey,
} from './projection';
import { useStatsStore } from './store';

const n = setNamespace('stats');

type Setter = StoreSetter<StatsState>;

/**
 * Several cards read the same entry at once (the token heatmap feeds the total
 * card, the heatmap and its summary), so one request answers every mounted
 * reader. Explicit revalidations (retry) are not deduped.
 */
const STATS_DEDUPE_MS = 10_000;

const SYNC_OPTIONS = { dedupingInterval: STATS_DEDUPE_MS };

const STATS_TOTAL_KINDS: StatsTotalKind[] = ['agents', 'topics', 'messages'];
const STATS_RANK_KINDS: StatsRankKind[] = ['agents', 'models', 'topics'];

const fetchTotal = async (kind: StatsTotalKind): Promise<StatsTotal> => {
  switch (kind) {
    case 'agents': {
      return {
        count: await agentService.countAgents(),
        prevCount: await agentService.countAgents({ endDate: lastMonth().format('YYYY-MM-DD') }),
      };
    }
    case 'topics': {
      return {
        count: await topicService.countTopics(),
        prevCount: await topicService.countTopics({ endDate: lastMonth().format('YYYY-MM-DD') }),
      };
    }
    case 'messages': {
      // The total is a planner estimate, but the last-month baseline is derived
      // from it with an exact count of this month's messages (cheap — date-
      // bounded) rather than a second estimate: without multicolumn statistics
      // the planner can badly misjudge a user×date predicate, which would turn
      // the growth percentage next to the number into noise.
      const count = await messageService.countMessages({ approximate: true });
      const sinceLastMonth = await messageService.countMessages({
        startDate: lastMonth().add(1, 'day').format('YYYY-MM-DD'),
      });
      return { count, prevCount: Math.max(count - sinceLastMonth, 0) };
    }
  }
};

const fetchCount = async (kind: StatsCountKind): Promise<StatsCount> => {
  switch (kind) {
    // assistants are counted from the agents table — the sidebar list source of truth
    case 'agents': {
      return { count: await agentService.countAgents() };
    }
    case 'topics': {
      return { count: await topicService.countTopics() };
    }
    case 'messages': {
      return {
        count: await messageService.countMessages({ approximate: true }),
        // today's delta stays exact — it is small, cheap, and shown as "+N"
        today: await messageService.countMessages({ startDate: today().format('YYYY-MM-DD') }),
      };
    }
  }
};

const fetchRank = (kind: StatsRankKind): Promise<StatsRankMap[StatsRankKind]> => {
  switch (kind) {
    case 'agents': {
      return agentService.rankAgents();
    }
    case 'models': {
      return messageService.rankModels();
    }
    case 'topics': {
      return topicService.rankTopics();
    }
  }
};

export class StatsActionImpl {
  readonly #agentUsage;
  readonly #count;
  readonly #heatmap;
  readonly #maxTaskDuration;
  readonly #rank;
  readonly #registration;
  readonly #set: Setter;
  readonly #total;
  readonly #usageByDay;
  readonly #usageLogs;

  constructor(set: Setter, get: () => StatsState) {
    this.#set = set;

    this.#total = createReplicaSlice(statsTotalResource, {
      actionPrefix: 'statsTotal',
      fetcher: fetchTotal,
      get,
      set,
      stateKey: 'totalReplica',
      view: recordLens<StatsState, StatsTotal>('totalMap'),
    });
    this.#count = createReplicaSlice(statsCountResource, {
      actionPrefix: 'statsCount',
      fetcher: fetchCount,
      get,
      set,
      stateKey: 'countReplica',
      view: recordLens<StatsState, StatsCount>('countMap'),
    });
    this.#heatmap = createReplicaSlice(statsHeatmapResource, {
      actionPrefix: 'statsHeatmap',
      fetcher: (kind) =>
        kind === 'tokens' ? messageService.getTokenHeatmaps() : messageService.getHeatmaps(),
      get,
      set,
      stateKey: 'heatmapReplica',
      view: recordLens<StatsState, StatsHeatmap>('heatmapMap'),
    });
    this.#rank = createReplicaSlice(statsRankResource, {
      actionPrefix: 'statsRank',
      fetcher: fetchRank,
      get,
      set,
      stateKey: 'rankReplica',
      view: recordLens<StatsState, StatsRankMap[StatsRankKind]>('rankMap'),
    });
    this.#registration = createReplicaSlice(statsRegistrationResource, {
      actionPrefix: 'statsRegistration',
      fetcher: () => userService.getUserRegistrationDuration(),
      get,
      set,
      stateKey: 'registrationReplica',
      view: recordLens<StatsState, StatsRegistration>('registrationMap'),
    });
    this.#maxTaskDuration = createReplicaSlice(statsMaxTaskDurationResource, {
      actionPrefix: 'statsMaxTaskDuration',
      fetcher: () => topicService.getMaxTaskDuration(),
      get,
      set,
      stateKey: 'maxTaskDurationReplica',
      view: recordLens<StatsState, number>('maxTaskDurationMap'),
    });
    this.#usageByDay = createReplicaSlice(usageByDayResource, {
      actionPrefix: 'usageByDay',
      fetcher: (month) => usageService.findAndGroupByDay(month),
      get,
      set,
      stateKey: 'usageByDayReplica',
      view: recordLens<StatsState, UsageByDay>('usageByDayMap'),
    });
    this.#usageLogs = createReplicaSlice(usageLogsResource, {
      actionPrefix: 'usageLogs',
      fetcher: (month) => usageService.findByMonth(month),
      get,
      set,
      stateKey: 'usageLogsReplica',
      view: recordLens<StatsState, UsageLogs>('usageLogsMap'),
    });
    this.#agentUsage = createReplicaSlice(agentUsageResource, {
      actionPrefix: 'agentUsage',
      fetcher: (params) => usageService.getAgentUsageStats(params),
      get,
      set,
      stateKey: 'agentUsageReplica',
      view: recordLens<StatsState, AgentUsageStats>('agentUsageMap'),
    });
  }

  useFetchTotal = (kind: StatsTotalKind): ReplicaSyncResult =>
    this.#total.useSync(kind, SYNC_OPTIONS);

  useFetchCount = (kind: StatsCountKind): ReplicaSyncResult =>
    this.#count.useSync(kind, SYNC_OPTIONS);

  useFetchHeatmap = (kind: StatsHeatmapKind): ReplicaSyncResult =>
    this.#heatmap.useSync(kind, SYNC_OPTIONS);

  useFetchRank = (kind: StatsRankKind): ReplicaSyncResult => this.#rank.useSync(kind, SYNC_OPTIONS);

  useFetchRegistration = (): ReplicaSyncResult =>
    this.#registration.useSync(SINGLE_KEY, SYNC_OPTIONS);

  useFetchMaxTaskDuration = (): ReplicaSyncResult =>
    this.#maxTaskDuration.useSync(SINGLE_KEY, SYNC_OPTIONS);

  /** `month` is `YYYY-MM`; omitted reads the current month. */
  useFetchUsageByDay = (month?: string): ReplicaSyncResult =>
    this.#usageByDay.useSync(usageMonthKey(month), SYNC_OPTIONS);

  useFetchUsageLogs = (month?: string): ReplicaSyncResult =>
    this.#usageLogs.useSync(usageMonthKey(month), SYNC_OPTIONS);

  useFetchAgentUsage = (params: AgentUsageParams | null): ReplicaSyncResult =>
    this.#agentUsage.useSync(params, SYNC_OPTIONS);

  /**
   * Seed the persisted Settings → Stats entries before the route commits (see
   * `statsPageLoader`): `useSync` only hydrates after mount, which would leave
   * the cards on their loading state for the IndexedDB read.
   */
  preHydrateStatsPage = (): Promise<unknown> => {
    const scope = cacheScope.get();
    // The slots may still hold the previous identity's rows; drop them before seeding.
    for (const slice of [
      this.#total,
      this.#heatmap,
      this.#rank,
      this.#registration,
      this.#maxTaskDuration,
      this.#usageByDay,
      this.#usageLogs,
    ]) {
      slice.ensureScope(scope);
    }

    return Promise.all([
      ...STATS_TOTAL_KINDS.map((kind) => this.#total.hydrate(kind, scope)),
      // The heatmap opens on its token tab.
      this.#heatmap.hydrate('tokens', scope),
      ...STATS_RANK_KINDS.map((kind) => this.#rank.hydrate(kind, scope)),
      this.#registration.hydrate(SINGLE_KEY, scope),
      this.#maxTaskDuration.hydrate(SINGLE_KEY, scope),
      // The usage section opens on the current month.
      this.#usageByDay.hydrate(usageMonthKey(), scope),
      this.#usageLogs.hydrate(usageMonthKey(), scope),
    ]);
  };

  /** Same as `preHydrateStatsPage`, for an agent's usage tab (`agentUsageLoader`). */
  preHydrateAgentUsage = (params: AgentUsageParams): Promise<boolean> => {
    const scope = cacheScope.get();
    this.#agentUsage.ensureScope(scope);
    return this.#agentUsage.hydrate(params, scope);
  };

  reset = (): void => {
    // `clear()` drops in-flight reads of the previous data context and this
    // scope's persisted rows, so a new identity never paints the old numbers.
    for (const slice of [
      this.#agentUsage,
      this.#count,
      this.#heatmap,
      this.#maxTaskDuration,
      this.#rank,
      this.#registration,
      this.#total,
      this.#usageByDay,
      this.#usageLogs,
    ]) {
      void slice.clear();
    }
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useStatsStore;

export const statsActions = new StatsActionImpl(setState, getState);
