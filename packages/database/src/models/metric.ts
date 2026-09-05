import type { MetricConfig, MetricKind, MetricSubjectType } from '@lobechat/types';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type { MetricItem, MetricPointItem, NewMetricPoint } from '../schemas/metric';
import { metricPoints, metrics } from '../schemas/metric';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface EnsureMetricParams {
  config?: MetricConfig;
  key: string;
  kind?: MetricKind;
  metadata?: unknown;
  subjectId: string;
  subjectType: MetricSubjectType;
  title?: string;
  unit?: string;
}

export type MetricPatch = Partial<
  Pick<MetricItem, 'title' | 'unit' | 'kind' | 'config' | 'metadata'>
>;

export type AddMetricPointParams = Omit<
  NewMetricPoint,
  'id' | 'metricId' | 'userId' | 'workspaceId' | 'createdAt'
>;

/** Time bucket widths `listPoints` can aggregate into — `date_trunc` fields. */
export type MetricBucket = 'hour' | 'day' | 'week' | 'month';

export interface ListMetricPointsOptions {
  bucket?: MetricBucket;
  from?: Date;
  limit?: number;
  to?: Date;
}

/** One chartable observation, raw or bucket-aggregated. */
export interface MetricChartPoint {
  observedAt: Date;
  value: number;
}

/** Bounded so an unbounded series cannot flood a chart read. */
const DEFAULT_POINT_LIMIT = 2000;

/**
 * Owns the `metrics` / `metric_points` tables: generic numeric time series
 * split into series definition and append-only data.
 *
 * The model knows nothing about any subject domain — a series is addressed by
 * its polymorphic (subjectType, subjectId, key) triple or by id, and consumers
 * (goal criteria, agent dashboards) attach their own meaning. Points always
 * enter through a series the caller owns; reads on points still filter by the
 * denormalized ownership columns so they never need the join.
 */
export class MetricModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private seriesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, metrics);

  private pointOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, metricPoints);

  // ── Series ──────────────────────────────────────────────

  /**
   * Idempotent "make sure this series exists" for write paths (probes retry,
   * and two samplers may race on first write). On conflict the insert is a
   * no-op and the existing row is returned — definition fields are NOT
   * overwritten, that is `update`'s job.
   *
   * Returns undefined when the (subject, key) slot is taken by a row outside
   * this owner scope — possible only if subject ids collide across owners,
   * but the ownership filter must not be widened to "fix" it.
   */
  ensure = async (params: EnsureMetricParams): Promise<MetricItem | undefined> => {
    const [inserted] = await this.db
      .insert(metrics)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;

    return this.findByKey(params.subjectType, params.subjectId, params.key);
  };

  findById = async (id: string): Promise<MetricItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, id), this.seriesOwnership()))
      .limit(1);
    return row;
  };

  findByKey = async (
    subjectType: MetricSubjectType,
    subjectId: string,
    key: string,
  ): Promise<MetricItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(metrics)
      .where(
        and(
          eq(metrics.subjectType, subjectType),
          eq(metrics.subjectId, subjectId),
          eq(metrics.key, key),
          this.seriesOwnership(),
        ),
      )
      .limit(1);
    return row;
  };

  /**
   * The named series of one subject. Distinct from {@link findBySubject}: a
   * caller that already knows which keys it needs — an acceptance contract
   * naming a handful — must not materialize every series the subject has ever
   * sampled, which nothing bounds.
   */
  findByKeys = async (
    subjectType: MetricSubjectType,
    subjectId: string,
    keys: string[],
  ): Promise<MetricItem[]> => {
    if (keys.length === 0) return [];

    return this.db
      .select()
      .from(metrics)
      .where(
        and(
          eq(metrics.subjectType, subjectType),
          eq(metrics.subjectId, subjectId),
          inArray(metrics.key, keys),
          this.seriesOwnership(),
        ),
      )
      .orderBy(asc(metrics.key));
  };

  findBySubject = async (
    subjectType: MetricSubjectType,
    subjectId: string,
  ): Promise<MetricItem[]> => {
    return this.db
      .select()
      .from(metrics)
      .where(
        and(
          eq(metrics.subjectType, subjectType),
          eq(metrics.subjectId, subjectId),
          this.seriesOwnership(),
        ),
      )
      .orderBy(asc(metrics.key));
  };

  update = async (id: string, patch: MetricPatch): Promise<MetricItem | undefined> => {
    const [row] = await this.db
      .update(metrics)
      .set(patch)
      .where(and(eq(metrics.id, id), this.seriesOwnership()))
      .returning();
    return row;
  };

  /**
   * Hard delete; points cascade with the series. Returns the deleted row so
   * the caller can tell a completed deletion from a stale or foreign id.
   */
  delete = async (id: string): Promise<MetricItem | undefined> => {
    const [row] = await this.db
      .delete(metrics)
      .where(and(eq(metrics.id, id), this.seriesOwnership()))
      .returning();
    return row;
  };

  // ── Points ──────────────────────────────────────────────

  /**
   * Append one observation. The series is resolved under the caller's
   * ownership first — a point can never be attached to somebody else's series,
   * and the returned undefined tells the caller the series id was bad.
   */
  addPoint = async (
    metricId: string,
    point: AddMetricPointParams,
  ): Promise<MetricPointItem | undefined> => {
    const series = await this.findById(metricId);
    if (!series) return undefined;

    const [row] = await this.db
      .insert(metricPoints)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...point, metricId },
        ),
      )
      .returning();
    return row;
  };

  /** The most recent observation — what numeric acceptance criteria read. */
  latestPoint = async (metricId: string): Promise<MetricPointItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(metricPoints)
      .where(and(eq(metricPoints.metricId, metricId), this.pointOwnership()))
      .orderBy(desc(metricPoints.observedAt))
      .limit(1);
    return row;
  };

  /**
   * The latest observation of many series at once, keyed by metric id.
   *
   * `DISTINCT ON` keeps this one query however many series are asked for —
   * the per-series `latestPoint` is fine for a single read, but a caller
   * evaluating a whole acceptance contract would otherwise issue one query per
   * clause and pace the connection pool with it.
   */
  latestPointsByMetricIds = async (metricIds: string[]): Promise<Map<string, MetricPointItem>> => {
    if (metricIds.length === 0) return new Map();

    const rows = await this.db
      .selectDistinctOn([metricPoints.metricId])
      .from(metricPoints)
      .where(and(inArray(metricPoints.metricId, metricIds), this.pointOwnership()))
      .orderBy(metricPoints.metricId, desc(metricPoints.observedAt));

    return new Map(rows.map((row) => [row.metricId, row]));
  };

  /**
   * Range read for charts. Without `bucket`, raw points in ascending time.
   * With `bucket`, points are `date_trunc`-grouped and aggregated by the
   * series' own semantics — `counter` takes max (a monotone total must never
   * average down), `gauge` takes avg. Returns undefined when the series is
   * not visible to this owner, so callers can distinguish "no data" from
   * "no series".
   *
   * When the range holds more rows than `limit`, the *newest* window is kept
   * (fetched descending, then reversed for rendering) — a chart that silently
   * drops its current tail goes stale, while a truncated history is visibly
   * incomplete on the left edge.
   */
  listPoints = async (
    metricId: string,
    options: ListMetricPointsOptions = {},
  ): Promise<{ points: MetricChartPoint[]; series: MetricItem } | undefined> => {
    const series = await this.findById(metricId);
    if (!series) return undefined;

    const { bucket, from, limit = DEFAULT_POINT_LIMIT, to } = options;

    const where = and(
      eq(metricPoints.metricId, metricId),
      from ? gte(metricPoints.observedAt, from) : undefined,
      to ? lte(metricPoints.observedAt, to) : undefined,
      this.pointOwnership(),
    );

    if (!bucket) {
      const rows = await this.db
        .select({ observedAt: metricPoints.observedAt, value: metricPoints.value })
        .from(metricPoints)
        .where(where)
        .orderBy(desc(metricPoints.observedAt))
        .limit(limit);
      return { points: rows.reverse(), series };
    }

    const bucketExpr = sql`date_trunc(${bucket}, ${metricPoints.observedAt})`;
    const aggExpr =
      series.kind === 'counter' ? sql`max(${metricPoints.value})` : sql`avg(${metricPoints.value})`;
    const rows = await this.db
      .select({
        observedAt: bucketExpr.mapWith((v: string | Date) => new Date(v)),
        value: aggExpr.mapWith(Number),
      })
      .from(metricPoints)
      .where(where)
      // Positional, not repeated expressions: the bucket rides in as a bind
      // parameter, and Postgres will not match two date_trunc($n, …) calls
      // with different parameter slots as the same grouping expression.
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`)
      .limit(limit);
    return { points: rows.reverse(), series };
  };
}
