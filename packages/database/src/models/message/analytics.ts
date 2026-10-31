import type { DBMessageItem, ModelRankItem } from '@lobechat/types';
import type { HeatmapsProps } from '@lobehub/charts';
import dayjs from 'dayjs';
import { and, asc, count, desc, eq, getTableColumns, gt, isNotNull, sql } from 'drizzle-orm';

import { today } from '@/utils/time';

import { agents, messages } from '../../schemas';
import { notCopiedTranscript } from '../../utils/copiedTranscript';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../../utils/genWhere';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import { nonNull } from '../utils/rows';
import { MessageScope } from './scope';
import type { MessageAnalyticsFilters, TopicMessageCountItem, TopicMessageStats } from './types';

/**
 * Linear-interpolation percentile over an ascending-sorted array, matching
 * PostgreSQL's `percentile_cont`. Returns 0 for an empty input.
 */
const percentileCont = (sorted: number[], q: number): number => {
  const n = sorted.length;
  /* v8 ignore next -- unreachable: the only caller returns early when there are no counts */
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
};

/** Reduce a list of per-topic message counts into a {@link TopicMessageStats}. */
const computeTopicMessageStats = (counts: number[]): TopicMessageStats => {
  const topics = counts.length;
  if (topics === 0) {
    return {
      histogram: [],
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      oneshot: 0,
      oneshotRatio: 0,
      p90: 0,
      p99: 0,
      topics: 0,
      totalMessages: 0,
    };
  }

  const sorted = [...counts].sort((a, b) => a - b);
  const totalMessages = sorted.reduce((acc, c) => acc + c, 0);
  const oneshot = sorted.filter((c) => c === 1).length;

  const bucket = new Map<number, number>();
  for (const c of sorted) bucket.set(c, (bucket.get(c) ?? 0) + 1);
  const histogram = [...bucket.entries()]
    .sort(([a], [b]) => a - b)
    .map(([userCount, topicCount]) => ({ topics: topicCount, userCount }));

  return {
    histogram,
    max: sorted[topics - 1],
    mean: totalMessages / topics,
    median: percentileCont(sorted, 0.5),
    min: sorted[0],
    oneshot,
    oneshotRatio: oneshot / topics,
    p90: percentileCont(sorted, 0.9),
    p99: percentileCont(sorted, 0.99),
    topics,
    totalMessages,
  };
};

export class MessageAnalyticsQueries extends MessageScope {
  /**
   * Full creator-facing message dump (`getAllMessages` / CLI export), so
   * agent-share visitor messages must be excluded like every other
   * creator-facing listing. The exclusion rides on
   * {@link MessageModel.analyticsConditions}, which already ANDs
   * `notShareVisitorMessage()` — see `../utils/shareVisitor`.
   */
  queryAll = async (params?: MessageAnalyticsFilters & { current?: number; pageSize?: number }) => {
    const { current = 0, pageSize = 100, ...filters } = params ?? {};
    const offset = current * pageSize;

    const result = await this.db
      .select({
        ...getTableColumns(messages),
        agentName: agents.name,
        agentTitle: agents.title,
      })
      .from(messages)
      .leftJoin(agents, eq(messages.agentId, agents.id))
      .where(genWhere(this.analyticsConditions(filters)))
      .orderBy(desc(messages.createdAt))
      .limit(pageSize)
      .offset(offset);

    return result as (DBMessageItem & {
      agentName: string | null;
      agentTitle: string | null;
    })[];
  };

  /**
   * Ownership-scoped analytics filter conditions, shared by count /
   * countGroupByTopic / topicMessageStats. The first entry is always the
   * `userId × workspace` ownership predicate; later entries are optional.
   * Agent-share visitor messages carry the creator's `userId`, so personal
   * analytics must exclude them (visitor usage is reported separately by the
   * share usage center) — see `notShareVisitorMessage` in `../utils/shareVisitor`.
   *
   * MUST NOT be applied to {@link countByTopic} — see that method's JSDoc for
   * why exact per-topic turn counting needs the visitor topic's own messages.
   */
  private analyticsConditions = (params?: MessageAnalyticsFilters) => [
    this.ownership(),
    notShareVisitorMessage(),
    params?.agentId ? eq(messages.agentId, params.agentId) : undefined,
    params?.topicId ? eq(messages.topicId, params.topicId) : undefined,
    params?.role ? eq(messages.role, params.role) : undefined,
    params?.range
      ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
      : undefined,
    params?.endDate
      ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
      : undefined,
    params?.startDate
      ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
      : undefined,
  ];

  count = async (params?: MessageAnalyticsFilters): Promise<number> => {
    const result = await this.db
      .select({
        count: count(messages.id),
      })
      .from(messages)
      .where(genWhere(this.analyticsConditions(params)));

    return result[0].count;
  };

  /**
   * Approximate variant of {@link count} for dashboard totals. An exact
   * COUNT over `messages` heap-fetches every row the user owns (tens of
   * seconds for accounts with 100k+ messages), which no stats card needs.
   *
   * Strategy: ask the planner for a row estimate first (EXPLAIN, a few ms).
   * Accounts the estimate marks as clearly heavy get the estimate, rounded
   * to 3 significant digits so the number reads as the approximation it is.
   * Everyone else — the vast majority — gets an exact count capped at
   * `cap + 1` rows, which is cheap at that size. A user the planner
   * underestimates still can't get a value below what the capped scan saw.
   * Parallel workers are disabled for the EXPLAIN because parallel plans
   * report per-worker row estimates, not totals.
   */
  countApproximate = async (
    params?: MessageAnalyticsFilters,
    { cap = 10_000 }: { cap?: number } = {},
  ): Promise<number> => {
    const where = genWhere(this.analyticsConditions(params));

    const roundEstimate = (estimate: number) => {
      const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(estimate)) - 2);
      return Math.round(estimate / magnitude) * magnitude;
    };

    let estimate: number | undefined;
    try {
      const estimateQuery = this.db.select({ id: messages.id }).from(messages).where(where);
      const result = await this.db.transaction(async (trx) => {
        await trx.execute(sql`SET LOCAL max_parallel_workers_per_gather = 0`);
        return trx.execute(sql`EXPLAIN (FORMAT JSON) ${estimateQuery.getSQL()}`);
      });
      const rawPlan = result.rows[0]?.['QUERY PLAN'];
      const parsed = typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan;
      const parsedRows = Number((parsed as any)?.[0]?.['Plan']?.['Plan Rows']);
      if (Number.isFinite(parsedRows)) estimate = parsedRows;
    } catch (error) {
      // Best-effort — fall through to the capped exact count, but surface the
      // degradation: past-cap accounts will all read as `cap + 1` until fixed.
      console.error('countApproximate: planner estimate failed, using capped count only:', error);
    }

    if (estimate !== undefined && estimate > cap * 2) return roundEstimate(estimate);

    const cappedRows = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(where)
      .limit(cap + 1)
      .as('capped');
    const capped = await this.db.select({ count: count() }).from(cappedRows);
    const exact = capped[0].count;
    if (exact <= cap) return exact;

    return Math.max(estimate === undefined ? 0 : roundEstimate(estimate), exact);
  };

  /**
   * Count matching messages grouped by topic, sorted by count desc.
   * Topics without a `topicId` are excluded. Pushes the GROUP BY to the DB
   * so callers don't have to paginate raw rows and count client-side.
   */
  countGroupByTopic = async (
    params?: MessageAnalyticsFilters,
  ): Promise<TopicMessageCountItem[]> => {
    const rows = await this.db
      .select({
        count: count(messages.id),
        topicId: messages.topicId,
      })
      .from(messages)
      .where(genWhere([...this.analyticsConditions(params), isNotNull(messages.topicId)]))
      .groupBy(messages.topicId)
      .orderBy(desc(sql`count`), asc(messages.topicId));

    return rows.map((r) => ({ count: r.count, topicId: r.topicId! }));
  };

  /**
   * Distribution of message counts per topic (topics / mean / median /
   * p90 / p99 / min / max / one-shot ratio + histogram). The per-topic
   * counts are aggregated in the DB; only the final summary is returned.
   */
  topicMessageStats = async (params?: MessageAnalyticsFilters): Promise<TopicMessageStats> => {
    const rows = await this.db
      .select({
        count: count(messages.id),
        topicId: messages.topicId,
      })
      .from(messages)
      .where(genWhere([...this.analyticsConditions(params), isNotNull(messages.topicId)]))
      .groupBy(messages.topicId);

    return computeTopicMessageStats(rows.map((r) => r.count));
  };

  hasTopicMessages = async (topicId: string): Promise<boolean> => {
    const rows = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.topicId, topicId), this.ownership()))
      .limit(1);

    return rows.length > 0;
  };

  findFirstAssistantInTopic = async (topicId: string): Promise<DBMessageItem | undefined> => {
    const rows = (await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.topicId, topicId), eq(messages.role, 'assistant'), this.ownership()))
      .orderBy(asc(messages.createdAt))
      .limit(1)) as DBMessageItem[];

    return rows[0];
  };

  countWords = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: sql<string>`sum(length(${messages.content}))`.as('total_length'),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          notShareVisitorMessage(),
          params?.range
            ? genRangeWhere(params.range, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, messages.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, messages.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return Number(result[0].count);
  };

  rankModels = async (limit: number = 10): Promise<ModelRankItem[]> => {
    return this.db
      .select({
        count: count(messages.id).as('count'),
        id: messages.model,
      })
      .from(messages)
      .where(
        and(
          this.ownership(),
          notShareVisitorMessage(),
          isNotNull(messages.model),
          notCopiedTranscript(),
        ),
      )
      .having(({ count }) => gt(count, 0))
      .groupBy(messages.model)
      .orderBy(desc(sql`count`), asc(messages.model))
      .limit(limit);
  };

  getHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    const startDate = today().subtract(1, 'year').startOf('day');
    const endDate = today().endOf('day');

    const result = await this.db
      .select({
        count: count(messages.id),
        date: sql`DATE(${messages.createdAt})`.as('heatmaps_date'),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          notShareVisitorMessage(),
          genRangeWhere(
            [startDate.format('YYYY-MM-DD'), endDate.add(1, 'day').format('YYYY-MM-DD')],
            messages.createdAt,
            (date) => date.toDate(),
          ),
        ]),
      )
      .groupBy(sql`heatmaps_date`)
      .orderBy(desc(sql`heatmaps_date`));

    const heatmapData: HeatmapsProps['data'] = [];
    let currentDate = startDate.clone();

    const dateCountMap = new Map<string, number>();
    for (const item of result) {
      // messages.created_at is NOT NULL, so DATE(created_at) is never NULL.
      const date = nonNull(item.date, 'DATE(messages.created_at)') as string;
      dateCountMap.set(dayjs(date).format('YYYY-MM-DD'), item.count);
    }

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const formattedDate = currentDate.format('YYYY-MM-DD');
      const count = dateCountMap.get(formattedDate) || 0;

      const levelCount = count > 0 ? Math.ceil(count / 5) : 0;
      const level = levelCount > 4 ? 4 : levelCount;

      heatmapData.push({
        count,
        date: formattedDate,
        level,
      });

      currentDate = currentDate.add(1, 'day');
    }

    return heatmapData;
  };

  /**
   * Daily token-usage heatmap for the last year.
   *
   * Sums `usage.totalTokens` of assistant messages bucketed by the day each
   * message was created — so tokens land on the day they were actually consumed
   * (a long-running topic spreads across days instead of piling onto its
   * creation date). Reads prefer the dedicated `usage` column and fall back to
   * legacy `metadata.usage`, aggregating directly in SQL rather than pulling
   * rows into JS. `level` is scaled relative to the busiest day so the heatmap
   * stays readable regardless of absolute token volume.
   */
  getTokenHeatmaps = async (): Promise<HeatmapsProps['data']> => {
    const startDate = today().subtract(1, 'year').startOf('day');
    const endDate = today().endOf('day');

    const result = await this.db
      .select({
        date: sql`DATE(${messages.createdAt})`.as('heatmaps_date'),
        tokens:
          sql<number>`COALESCE(SUM((COALESCE(${messages.usage}, ${messages.metadata}->'usage')->>'totalTokens')::numeric), 0)`.mapWith(
            Number,
          ),
      })
      .from(messages)
      .where(
        genWhere([
          this.ownership(),
          notShareVisitorMessage(),
          eq(messages.role, 'assistant'),
          notCopiedTranscript(),
          genRangeWhere(
            [startDate.format('YYYY-MM-DD'), endDate.add(1, 'day').format('YYYY-MM-DD')],
            messages.createdAt,
            (date) => date.toDate(),
          ),
        ]),
      )
      .groupBy(sql`heatmaps_date`)
      .orderBy(desc(sql`heatmaps_date`));

    const dateTokenMap = new Map<string, number>();
    let maxTokens = 0;
    for (const item of result) {
      // messages.created_at is NOT NULL, so DATE(created_at) is never NULL.
      const date = nonNull(item.date, 'DATE(messages.created_at)') as string;
      const tokens = item.tokens || 0;
      dateTokenMap.set(dayjs(date).format('YYYY-MM-DD'), tokens);
      if (tokens > maxTokens) maxTokens = tokens;
    }

    const heatmapData: HeatmapsProps['data'] = [];
    let currentDate = startDate.clone();

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const formattedDate = currentDate.format('YYYY-MM-DD');
      const tokens = dateTokenMap.get(formattedDate) || 0;

      // Scale to 1-4 relative to the busiest day; 0 tokens stays at level 0.
      const level =
        tokens > 0 && maxTokens > 0
          ? Math.min(4, Math.max(1, Math.ceil((tokens / maxTokens) * 4)))
          : 0;

      heatmapData.push({
        count: tokens,
        date: formattedDate,
        level,
      });

      currentDate = currentDate.add(1, 'day');
    }

    return heatmapData;
  };

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(this.ownership()))
      .limit(n + 1);

    return result.length > n;
  };

  /**
   * Count messages up to a limit, useful for avoiding full table scans
   */
  countUpTo = async (n: number): Promise<number> => {
    const result = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(this.ownership()))
      .limit(n);

    return result.length;
  };
}
