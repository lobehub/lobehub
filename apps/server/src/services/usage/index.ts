import dayjs from 'dayjs';
import debug from 'debug';
import { and, eq, isNull, type SQL } from 'drizzle-orm';

import { messages, sessions, topics } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { genRangeWhere, genWhere } from '@/database/utils/genWhere';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { type MessageMetadata, type ModelUsage } from '@/types/message';
import {
  type AgentUsageBucket,
  type AgentUsageGranularity,
  type AgentUsageModelRow,
  type AgentUsageStats,
  type UsageLog,
  type UsageRecordItem,
} from '@/types/usage/usageRecord';
import { formatDate } from '@/utils/format';

import { computeMessageCostSplit } from './cost';

const log = debug('lobe-usage:service');

export class UsageRecordService {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;
  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.db = db;
  }

  /**
   * `messages.user_id`/`workspace_id` are creation-time snapshots that go
   * stale after agent transfers — usage reads derive scope from the owning
   * topic/session instead, fanned out over the three derivation arms so each
   * stays index-bounded (same strategy as `MessageModel.count`).
   */
  private scopeArms = () => {
    const ctx = { userId: this.userId, workspaceId: this.workspaceId };
    return {
      orphan: and(
        isNull(messages.topicId),
        isNull(messages.sessionId),
        buildWorkspaceWhere(ctx, messages),
      ) as SQL,
      sessionOwned: and(isNull(messages.topicId), buildWorkspaceWhere(ctx, sessions)) as SQL,
      topicOwned: buildWorkspaceWhere(ctx, topics),
    };
  };

  /**
   * @description Find usage records by date range.
   * @param agentId Optional agent id to attribute usage to a single agent.
   */
  findByDateRange = async (
    startAt: string,
    endAt: string,
    agentId?: string,
  ): Promise<UsageRecordItem[]> => {
    const selection = {
      createdAt: messages.createdAt,
      id: messages.id,
      metadata: messages.metadata,
      model: messages.model,
      provider: messages.provider,
      role: messages.role,
      updatedAt: messages.createdAt,
      usage: messages.usage,
      userId: messages.userId,
    };
    const conditions = [
      eq(messages.role, 'assistant'),
      agentId ? eq(messages.agentId, agentId) : undefined,
      genRangeWhere([startAt, endAt], messages.createdAt, (date) => date.toDate()),
    ];
    const { topicOwned, sessionOwned, orphan } = this.scopeArms();
    const [byTopic, bySession, orphans] = await Promise.all([
      this.db
        .select(selection)
        .from(messages)
        .innerJoin(topics, eq(topics.id, messages.topicId))
        .where(genWhere([topicOwned, ...conditions])),
      this.db
        .select(selection)
        .from(messages)
        .innerJoin(sessions, eq(sessions.id, messages.sessionId))
        .where(genWhere([sessionOwned, ...conditions])),
      this.db
        .select(selection)
        .from(messages)
        .where(genWhere([orphan, ...conditions])),
    ]);
    const spends = [...byTopic, ...bySession, ...orphans].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    );
    return spends.map((spend) => {
      const metadata = spend.metadata as MessageMetadata;
      // Prefer the dedicated `usage` column, then the canonical nested
      // `metadata.usage` / `metadata.performance` shapes, falling back to the
      // deprecated flat fields for messages written before the migration.
      const usage = spend.usage ?? metadata?.usage;
      const performance = metadata?.performance;
      const totalInputTokens = usage?.totalInputTokens ?? metadata?.totalInputTokens ?? 0;
      const totalOutputTokens = usage?.totalOutputTokens ?? metadata?.totalOutputTokens ?? 0;
      return {
        createdAt: spend.createdAt,
        id: spend.id,
        metadata: spend.metadata,
        model: spend.model,
        provider: spend.provider,
        spend: usage?.cost ?? metadata?.cost ?? 0,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        tps: performance?.tps ?? metadata?.tps ?? 0,
        ttft: performance?.ttft ?? metadata?.ttft ?? 0,
        type: 'chat',
        updatedAt: spend.createdAt,
        userId: spend.userId,
      } as UsageRecordItem;
    });
  };

  /**
   * @description Find usage records by month.
   * @param mo Month
   * @param agentId When provided, only count messages produced by this agent.
   * @returns UsageRecordItem[]
   */
  findByMonth = async (mo?: string, agentId?: string): Promise<UsageRecordItem[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    return this.findByDateRange(startAt, endAt, agentId);
  };

  /**
   * @description Group usage records by day for a given date range.
   */
  private groupByDay = (
    spends: UsageRecordItem[],
    startAt: string,
    endAt: string,
    pad = true,
  ): UsageLog[] => {
    // Clustering by time
    const usages = new Map<string, { date: Date; logs: UsageRecordItem[] }>();
    spends.forEach((spend) => {
      if (!usages.has(formatDate(spend.createdAt))) {
        usages.set(formatDate(spend.createdAt), { date: spend.createdAt, logs: [spend] });
        return;
      }
      usages.get(formatDate(spend.createdAt))?.logs.push(spend);
    });
    // Calculate usage
    const usageLogs: UsageLog[] = [];
    usages.forEach((spends, date) => {
      const totalSpend = spends.logs.reduce((acc, spend) => acc + spend.spend, 0);
      const totalTokens = spends.logs.reduce((acc, spend) => (spend.totalTokens || 0) + acc, 0);
      const totalRequests = spends.logs?.length ?? 0;
      log(
        'date',
        date,
        'totalSpend',
        totalSpend,
        'totalTokens',
        totalTokens,
        'totalRequests',
        totalRequests,
      );
      usageLogs.push({
        date: spends.date.getTime(),
        day: date,
        records: spends.logs,
        totalRequests,
        totalSpend,
        totalTokens,
      });
    });

    if (!pad) return usageLogs;

    // Padding to ensure the date range is complete
    const startDate = dayjs(startAt);
    const endDate = dayjs(endAt);
    const paddedUsageLogs: UsageLog[] = [];
    log(
      'Padding usage logs from',
      startDate.format('YYYY-MM-DD'),
      'to',
      endDate.format('YYYY-MM-DD'),
    );
    for (let date = startDate; date.isBefore(endDate); date = date.add(1, 'day')) {
      const found = usageLogs.find((l) => l.day === date.format('YYYY-MM-DD'));
      if (found) {
        paddedUsageLogs.push(found);
      } else {
        paddedUsageLogs.push({
          date: date.toDate().getTime(),
          day: date.format('YYYY-MM-DD'),
          records: [],
          totalRequests: 0,
          totalSpend: 0,
          totalTokens: 0,
        });
      }
    }
    return paddedUsageLogs;
  };

  findAndGroupByDay = async (mo?: string, agentId?: string): Promise<UsageLog[]> => {
    let startAt: string;
    let endAt: string;
    if (mo && dayjs(mo, 'YYYY-MM', true).isValid()) {
      startAt = dayjs(mo, 'YYYY-MM').startOf('month').format('YYYY-MM-DD');
      endAt = dayjs(mo, 'YYYY-MM').endOf('month').format('YYYY-MM-DD');
    } else {
      startAt = dayjs().startOf('month').format('YYYY-MM-DD');
      endAt = dayjs().endOf('month').format('YYYY-MM-DD');
    }
    const spends = await this.findByDateRange(startAt, endAt, agentId);
    return this.groupByDay(spends, startAt, endAt);
  };

  /**
   * @description Find usage grouped by day for a custom date range (e.g. past 12 months).
   * Does not pad missing days for large ranges.
   * @param agentId When provided, only count messages produced by this agent.
   */
  findAndGroupByDateRange = async (
    startAt: string,
    endAt: string,
    agentId?: string,
  ): Promise<UsageLog[]> => {
    const spends = await this.findByDateRange(startAt, endAt, agentId);
    return this.groupByDay(spends, startAt, endAt, false);
  };

  /**
   * @description Rich per-agent usage stats: cost (with cache savings), token
   * totals, and per-bucket input/output/cache-write split for a trend chart,
   * plus a per-model breakdown. Bucketed by day or week across [startAt, endAt].
   */
  getAgentUsageStats = async (
    agentId: string,
    startAt: string,
    endAt: string,
    granularity: AgentUsageGranularity = 'day',
  ): Promise<AgentUsageStats> => {
    const selection = {
      createdAt: messages.createdAt,
      metadata: messages.metadata,
      model: messages.model,
      provider: messages.provider,
      usage: messages.usage,
    };
    const conditions = [
      eq(messages.role, 'assistant'),
      eq(messages.agentId, agentId),
      genRangeWhere([startAt, endAt], messages.createdAt, (date) => date.toDate()),
    ];
    const { topicOwned, sessionOwned, orphan } = this.scopeArms();
    const [byTopic, bySession, orphans] = await Promise.all([
      this.db
        .select(selection)
        .from(messages)
        .innerJoin(topics, eq(topics.id, messages.topicId))
        .where(genWhere([topicOwned, ...conditions])),
      this.db
        .select(selection)
        .from(messages)
        .innerJoin(sessions, eq(sessions.id, messages.sessionId))
        .where(genWhere([sessionOwned, ...conditions])),
      this.db
        .select(selection)
        .from(messages)
        .where(genWhere([orphan, ...conditions])),
    ]);
    const rows = [...byTopic, ...bySession, ...orphans].sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );

    const bucketStart = (date: Date) =>
      granularity === 'week' ? dayjs(date).startOf('week') : dayjs(date).startOf('day');

    const buckets = new Map<string, AgentUsageBucket>();
    const models = new Map<string, AgentUsageModelRow>();
    const summary = {
      cacheHitRate: 0,
      cacheReadTokens: 0,
      cacheSavings: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      totalRequests: 0,
      totalTokens: 0,
    };
    let cacheMissTokens = 0;

    for (const row of rows) {
      const metadata = row.metadata as MessageMetadata | null;
      const usage = (row.usage as ModelUsage | null) ?? metadata?.usage;
      const storedCost = usage?.cost ?? metadata?.cost ?? 0;
      const split = computeMessageCostSplit(usage, row.provider, row.model, storedCost);

      // bucket
      const start = bucketStart(row.createdAt);
      const key = start.format('YYYY-MM-DD');
      const bucket = buckets.get(key) ?? {
        cachedInputCost: 0,
        cachedInputTokens: 0,
        cacheWriteCost: 0,
        cacheWriteTokens: 0,
        date: start.valueOf(),
        inputCost: 0,
        inputTokens: 0,
        label: start.format('M/D'),
        outputCost: 0,
        outputTokens: 0,
        totalCost: 0,
      };
      bucket.inputCost += split.inputCost;
      bucket.cachedInputCost += split.cachedInputCost;
      bucket.outputCost += split.outputCost;
      bucket.cacheWriteCost += split.cacheWriteCost;
      bucket.totalCost += split.totalCost;
      bucket.inputTokens += split.cacheMissTokens;
      bucket.cachedInputTokens += split.cacheReadTokens;
      bucket.outputTokens += split.outputTokens;
      bucket.cacheWriteTokens += split.cacheWriteTokens;
      buckets.set(key, bucket);

      // per-model
      const model = row.model || 'unknown';
      const provider = row.provider || 'unknown';
      const modelKey = `${provider}/${model}`;
      const modelRow = models.get(modelKey) ?? {
        cost: 0,
        id: modelKey,
        model,
        provider,
        requests: 0,
        totalTokens: 0,
      };
      modelRow.cost += split.totalCost;
      modelRow.totalTokens += split.totalTokens;
      modelRow.requests += 1;
      models.set(modelKey, modelRow);

      // summary
      summary.totalCost += split.totalCost;
      summary.cacheSavings += split.cacheSavings;
      summary.cacheReadTokens += split.cacheReadTokens;
      summary.inputTokens += split.inputTokens;
      summary.outputTokens += split.outputTokens;
      summary.totalTokens += split.totalTokens;
      summary.totalRequests += 1;
      cacheMissTokens += split.cacheMissTokens;
    }

    const cacheBase = summary.cacheReadTokens + cacheMissTokens;
    summary.cacheHitRate = cacheBase > 0 ? summary.cacheReadTokens / cacheBase : 0;

    // pad missing buckets so the chart spans the whole range
    const step = granularity === 'week' ? 'week' : 'day';
    const padded: AgentUsageBucket[] = [];
    const end = dayjs(endAt);
    for (
      let cursor = bucketStart(dayjs(startAt).toDate());
      cursor.isBefore(end) || cursor.isSame(end, step);
      cursor = cursor.add(1, step)
    ) {
      const key = cursor.format('YYYY-MM-DD');
      padded.push(
        buckets.get(key) ?? {
          cachedInputCost: 0,
          cachedInputTokens: 0,
          cacheWriteCost: 0,
          cacheWriteTokens: 0,
          date: cursor.valueOf(),
          inputCost: 0,
          inputTokens: 0,
          label: cursor.format('M/D'),
          outputCost: 0,
          outputTokens: 0,
          totalCost: 0,
        },
      );
    }

    return {
      buckets: padded,
      byModel: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
      summary,
    };
  };
}
