import type { DBMessageItem, ModelRankItem } from '@lobechat/types';
import type { HeatmapsProps } from '@lobehub/charts';
import dayjs from 'dayjs';
import { and, asc, count, desc, eq, getTableColumns, gt, isNotNull, type SQL, type SQLWrapper, sql } from 'drizzle-orm';

import { today } from '@/utils/time';

import { agents, messagePlugins, messages } from '../../schemas';
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

/**
 * SQL-layer redaction of inline media bodies, shared by the `arguments`
 * (text) and `state` (jsonb) projections of {@link queryAll}. The predicate
 * must cover everything the ingestion side accepts — builtin-tool-lobe-agent
 * media.ts accepts `/^data:(?:audio|image|video)\//i` URLs up to 2,000,000
 * chars, both `;base64,` and raw forms (`data:image/svg+xml,%3Csvg...` or
 * unencoded `<svg ...>` markup) — so the match is case-insensitive ('gi'),
 * the header uses the RFC 2045 token grammar (same as the file-loaders ipynb
 * scrub), the comma separator is REQUIRED (a plain long string like
 * `data:image/png followed by docs...` is not a data URL and must not be
 * rewritten), and the body has two branches: base64/percent bodies stop at
 * the first character outside the payload alphabet (suffix-preserving),
 * while raw-markup bodies redact through the JSON-string boundary via
 * complete units (`[^"\]` or an escaped pair like `\"`) — a bare-backslash
 * class would consume the `\` of a `\"` escape, leave the quote dangling,
 * and corrupt the JSON text (the jsonb cast then fails the whole query). The
 * mime header is kept as the capture so the export stays attribution-complete
 * without dumping megabytes of body.
 */
const MIME_TOKEN = '[^\\s()<>@,;:\\\\"/\\[\\]?=]';
const DATA_URL_HEADER =
// The parameter loop refuses only the exact `;base64,` encoding sentinel
// (`(?!base64(?=,))`). An earlier `(?!base64)` prefix lookahead also
// rejected ordinary parameters whose name merely starts with `base64`
// (e.g. `;base64url=x`) — ingestion accepts those via `new URL()`, and with
// the parameter stuck outside the header none of the redaction passes could
// reach the comma, so the full payload leaked through the export (Codex
// round-9 P2).
  `(data:(?:audio|image|video)/${MIME_TOKEN}+(?:;(?!base64(?=,))${MIME_TOKEN}+(?:=${MIME_TOKEN}*)?)*)`;
// base64 form: the payload alphabet stops at the first character outside it,
// so anything after the data URL (e.g. an escaped quote in an HTML
// attribute) survives the rewrite. The alphabet covers standard base64 AND
// the URL-safe variant (`-`/`_`): ingestion (builtin-tool-lobe-agent
// media.ts) accepts any parseable data:audio|image|video URL without
// validating the body encoding, so base64url bodies are a supported
// persisted form that must not leak through the export.
const DATA_URL_BASE64_PATTERN =
  `(${DATA_URL_HEADER};base64,)` +
  '(?:[A-Za-z0-9+/=_\\s-]|\\\\[nrtbf]|%[0-9a-fA-F]{2}){64,}';
// raw (non-base64) form, primary pass: markup/percent-encoded payloads stop
// at an escaped quote in complete units (`[^"\\]`, or an escaped pair whose
// second character is neither a quote nor a backslash `\\[^"\\]`). `\"`
// closes the embedded JSON string, so treating it as payload would run
// through the surrounding text (attribute suffix, markup tail) to the outer
// JSON boundary and silently truncate the exported content beyond the URL —
// the defect Codex flagged. `\\` pairs are refused here too: in DB text a
// post-URL escaped quote reads `\\\"` (escaped backslash + escaped quote),
// and consuming the `\\` pair would eat the value-level backslash that
// belongs to the suffix after the URL — refusing it keeps that backslash in
// the export and hands payloads that contain real backslashes to the
// fallback pass below. A bare-backslash class would also eat the `\` of a
// `\"` escape, leaving the quote dangling and corrupting the JSON text (the
// jsonb cast then fails the whole query) — both are excluded by the
// second-character guard. The lookahead keeps base64 URLs out of this
// branch, and the comma separator is REQUIRED so plain long strings
// (`data:image/png followed by docs...`) never match.
const DATA_URL_RAW_PATTERN =
  `(${DATA_URL_HEADER}(?!;base64),)` +
  '(?:(?:[^"\\\\]|\\\\[^"\\\\])){64,}';
// raw form, fallback pass: the primary pass above cannot match a payload
// that itself contains `\"` (double-quoted SVG attributes are the common
// case) — the match dies on the first embedded escaped quote and the whole
// URL leaks. This pass restores full-payload redaction for those (matching
// through to the outer JSON boundary, accepting the suffix truncation the
// primary pass avoids). The `(?!...redacted...)` lookahead after the comma
// keeps this pass off the primary pass's own output: the placeholder is a
// fixed 15-character quote-free literal, so a redacted URL can never
// re-match here and its preserved suffix is safe.
const DATA_URL_RAW_FALLBACK_PATTERN =
  `(${DATA_URL_HEADER}(?!;base64),(?!\\.\\.\\.redacted\\.\\.\\.))` +
  '(?:[^"\\\\]|\\\\.){64,}';
const DATA_URL_REDACT_PATTERNS = [
  DATA_URL_BASE64_PATTERN,
  DATA_URL_RAW_PATTERN,
  DATA_URL_RAW_FALLBACK_PATTERN,
];
const DATA_URL_REDACT_REPLACEMENT = '\\1...redacted...';


/**
 * Chain one `regexp_replace` per redaction pattern over the same column
 * expression (PostgreSQL ARE alternation is leftmost-longest, so the
 * base64 and raw-form predicates must run as sequential passes: the raw
 * branch's string-boundary semantics would otherwise swallow a base64
 * match's JSON suffix).
 */
const redactInlineMedia = (column: SQLWrapper, isJsonb: boolean) => {
  const base = isJsonb ? sql`${column}::text` : column;
  return DATA_URL_REDACT_PATTERNS.reduce(
    (acc, pattern) =>
      sql`regexp_replace(${acc}, ${pattern}, ${DATA_URL_REDACT_REPLACEMENT}, 'gi')`,
    base,
  );
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
        // Tool-call metadata lives on the 1:1 `message_plugins` row, not on
        // `messages`. Consumers (lh CLI `message list --json`, wiki-ingest
        // image-evidence verification) rely on these fields to attribute a
        // tool result to its originating call — same shape as queryByIds.
        tool_call_id: messagePlugins.toolCallId,
        plugin: {
          // `id` MUST be the first selected field: drizzle decides whether a
          // left-joined nested selection is null from its first column (see
          // queryWithWhere sender note), and every other plugin column is
          // nullable while partial rows without `api_name` are a supported
          // shape (write.ts persists `plugin?.apiName`). Anchoring on the
          // non-null PK keeps partial rows projected; it equals the message
          // id, so no sentinel stripping is needed.
          id: messagePlugins.id,
          apiName: messagePlugins.apiName,
          // `arguments` can carry inline-media payloads (data: URLs of up to
          // ~2MB each — see builtin-tool-lobe-agent media limits), and this
          // dump feeds `lh message list --json`, which prints rows verbatim.
          // Redact data-URL bodies (keep the mime header + `,...` marker, the
          // same shape `formatMediaUrlForError` uses) so the export stays
          // attribution-complete without dumping megabytes of base64.
          arguments: sql<string | null>`${redactInlineMedia(messagePlugins.arguments, false)}`,
          identifier: messagePlugins.identifier,
          type: messagePlugins.type,
        },
        pluginError: messagePlugins.error,
        pluginIntervention: messagePlugins.intervention,
        // `state` is jsonb and can carry inline media too — browser-tool
        // screenshots persist as `state.dataUrl` (builtin-tool-browser client
        // executor) and would otherwise serialize multi-MB base64 into the
        // verbatim CLI dump. Redact inside the JSON text at the SQL layer and
        // cast back to jsonb so consumers keep the object shape.
        pluginState: sql<
          Record<string, unknown> | null
        >`${redactInlineMedia(messagePlugins.state, true)}::jsonb`,
      })
      .from(messages)
      .leftJoin(agents, eq(messages.agentId, agents.id))
      .leftJoin(messagePlugins, and(eq(messagePlugins.id, messages.id), this.pluginsOwnership()))
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
