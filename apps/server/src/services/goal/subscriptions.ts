import type { GoalSubscriptionCursor } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { AgentModel } from '@/database/models/agent';
import { ProjectModel } from '@/database/models/project';
import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { MetricModel } from '@/database/models/metric';
import { WidgetModel } from '@/database/models/widget';
import { goals } from '@/database/schemas/goal';
import { type GoalSubscriptionRow, goalSubscriptions } from '@/database/schemas/goalSubscription';
import { metricPoints, metrics } from '@/database/schemas/metric';
import { widgetRuns, widgets } from '@/database/schemas/widget';
import { workspaceMembers } from '@/database/schemas/workspace';
import type { LobeChatDatabase } from '@/database/type';

import { scheduleGoalAdvance } from './scheduler';
import {
  freshObservation,
  planningInterval,
  subscriptionPolicySchema,
  subscriptionWakes,
} from './subscriptionPolicy';

export const bindSubscriptionSchema = subscriptionPolicySchema.extend({
  goalId: z.string().min(1),
  widgetId: z.string().uuid(),
  confirmedVersionId: z.string().uuid(),
  metricId: z.string().min(1).nullable(),
  criterionKey: z.string().min(1).max(255).optional(),
  // Read back the immutable version hash and explicitly confirm it.
  confirmedContentHash: z.string().length(64),
});
export const updateSubscriptionSchema = subscriptionPolicySchema.extend({
  id: z.string().uuid(),
  bindingRevision: z.number().int().positive(),
  enabled: z.boolean(),
});

const instant = (column: typeof widgetRuns.createdAt | typeof metricPoints.observedAt) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const unavailable = () =>
  new TRPCError({
    code: 'FORBIDDEN',
    message: 'Subscription source unavailable or confirmation obsolete',
  });

/** Existing runs and points are the only observation storage. */
export class GoalSubscriptionService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private async goal(db: LobeChatDatabase, id: string, manage = false) {
    const goal = await new GoalModel(db, this.userId, this.workspaceId).lockById(id);
    if (!goal) throw unavailable();
    if (
      goal.projectId &&
      !(await new ProjectModel(db, this.userId, this.workspaceId).findById(goal.projectId))
    )
      throw unavailable();
    if (
      goal.agentId &&
      !(await new AgentModel(db, this.userId, this.workspaceId).findById(goal.agentId))
    )
      throw unavailable();
    if (this.workspaceId) {
      const [member] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, this.workspaceId),
            eq(workspaceMembers.userId, this.userId),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .for('share');
      if (goal.userId !== this.userId) {
        const [ownerMember] = await db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, this.workspaceId),
              eq(workspaceMembers.userId, goal.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .for('share');
        if (!ownerMember) throw unavailable();
      }
      if (!member || (manage && goal.userId !== this.userId && member.role !== 'owner'))
        throw unavailable();
    }
    return goal;
  }

  private async source(
    db: LobeChatDatabase,
    sub: Pick<GoalSubscriptionRow, 'widgetId' | 'metricId' | 'confirmedVersionId' | 'binding'>,
    owner: string,
  ) {
    const model = new WidgetModel(db, owner, this.workspaceId);
    const widget = await model.findById(sub.widgetId);
    const readableByActor = await new WidgetModel(db, this.userId, this.workspaceId).findById(
      sub.widgetId,
    );
    const version = await model.findVersion(sub.widgetId, sub.confirmedVersionId);
    if (
      !widget ||
      !readableByActor ||
      !version ||
      widget.workspaceId !== (this.workspaceId ?? null) ||
      version.workspaceId !== widget.workspaceId ||
      version.userId !== widget.userId ||
      widget.publishedVersionId !== version.id ||
      version.contentHash !== sub.binding.semanticsHash
    )
      throw unavailable();
    if (sub.metricId)
      await db
        .select({ id: metrics.id })
        .from(metrics)
        .where(eq(metrics.id, sub.metricId))
        .for('share');
    const metric = sub.metricId
      ? await new MetricModel(db, owner, this.workspaceId).findById(sub.metricId)
      : undefined;
    if (
      sub.metricId &&
      (!metric ||
        metric.userId !== widget.userId ||
        metric.subjectType !== 'widget' ||
        metric.subjectId !== widget.id ||
        metric.key !== sub.binding.metric?.key ||
        metric.kind !== sub.binding.metric?.kind ||
        metric.unit !== sub.binding.metric?.unit ||
        !isRecord(metric.metadata) ||
        metric.metadata.widgetContentHash !== version.contentHash)
    )
      throw unavailable();
    return { widget, version, metric };
  }

  private async baseline(db: LobeChatDatabase, widgetId: string): Promise<GoalSubscriptionCursor> {
    await db.select({ id: widgets.id }).from(widgets).where(eq(widgets.id, widgetId)).for('update');
    const [last] = await db
      .select({ createdAt: instant(widgetRuns.createdAt), runId: widgetRuns.id })
      .from(widgetRuns)
      .where(eq(widgetRuns.widgetId, widgetId))
      .orderBy(desc(widgetRuns.createdAt), desc(widgetRuns.id))
      .limit(1);
    return { lastWakeAt: new Date().toISOString(), ...(last && { run: last }) };
  }

  bind = async (
    raw: z.infer<typeof bindSubscriptionSchema>,
    rebind?: { id: string; bindingRevision: number },
  ) => {
    const input = bindSubscriptionSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const goal = await this.goal(db, input.goalId, true);
      const widget = await new WidgetModel(db, goal.userId, this.workspaceId).findById(
        input.widgetId,
      );
      const metric = input.metricId
        ? await new MetricModel(db, goal.userId, this.workspaceId).findById(input.metricId)
        : undefined;
      if (
        !widget ||
        (input.metricId && !metric) ||
        (input.criterionKey && !metric) ||
        (!metric && ['threshold', 'change'].includes(input.wakeCondition.type))
      )
        throw unavailable();
      const binding = {
        criterionKey: input.criterionKey,
        semanticsHash: input.confirmedContentHash,
        ...(metric && { metric: { key: metric.key, kind: metric.kind, unit: metric.unit } }),
      };
      await db
        .select({ id: widgets.id })
        .from(widgets)
        .where(eq(widgets.id, input.widgetId))
        .for('update');
      await this.source(db, { ...input, binding }, goal.userId);
      const existing = await db
        .select()
        .from(goalSubscriptions)
        .where(eq(goalSubscriptions.goalId, goal.id));
      if (
        input.criterionKey &&
        existing.some((s) => s.id !== rebind?.id && s.binding.criterionKey === input.criterionKey)
      )
        throw new TRPCError({ code: 'CONFLICT', message: 'Criterion already bound' });
      const cursor = await this.baseline(db, input.widgetId);
      const values = {
        binding,
        cursor,
        enabled: false,
        confirmedVersionId: input.confirmedVersionId,
        metricId: input.metricId,
        widgetId: input.widgetId,
        freshnessPolicy: input.freshnessPolicy,
        wakeCondition: input.wakeCondition,
        updatedAt: new Date(),
      };
      if (rebind) {
        const [row] = await db
          .update(goalSubscriptions)
          .set({ ...values, bindingRevision: rebind.bindingRevision + 1 })
          .where(
            and(
              eq(goalSubscriptions.id, rebind.id),
              eq(goalSubscriptions.goalId, goal.id),
              eq(goalSubscriptions.bindingRevision, rebind.bindingRevision),
            ),
          )
          .returning();
        if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Binding revision changed' });
        return row;
      }
      const [row] = await db
        .insert(goalSubscriptions)
        .values({ ...values, goalId: goal.id, userId: goal.userId, workspaceId: goal.workspaceId })
        .returning();
      return row;
    });
  };

  update = async (raw: z.infer<typeof updateSubscriptionSchema>) => {
    const input = updateSubscriptionSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const [sub] = await db
        .select()
        .from(goalSubscriptions)
        .where(eq(goalSubscriptions.id, input.id));
      if (!sub) throw unavailable();
      const goal = await this.goal(db, sub.goalId, true);
      await db
        .select({ id: widgets.id })
        .from(widgets)
        .where(eq(widgets.id, sub.widgetId))
        .for('update');
      if (input.enabled) await this.source(db, sub, goal.userId);
      if (!sub.metricId && ['threshold', 'change'].includes(input.wakeCondition.type))
        throw unavailable();
      // Every explicit activation starts after all already reserved runs; resume
      // cannot silently reuse pre-pause evidence. Revision fences all old callbacks.
      const cursor =
        input.enabled && !sub.enabled ? await this.baseline(db, sub.widgetId) : sub.cursor;
      const [row] = await db
        .update(goalSubscriptions)
        .set({
          enabled: input.enabled,
          cursor,
          wakeCondition: input.wakeCondition,
          freshnessPolicy: input.freshnessPolicy,
          bindingRevision: input.bindingRevision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(goalSubscriptions.id, input.id),
            eq(goalSubscriptions.bindingRevision, input.bindingRevision),
          ),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Binding revision changed' });
      return row;
    });
  };

  setEnabled = async (id: string, bindingRevision: number, enabled: boolean) => {
    const [sub] = await this.db
      .select()
      .from(goalSubscriptions)
      .where(eq(goalSubscriptions.id, id));
    if (!sub) throw unavailable();
    return this.update({
      id,
      bindingRevision,
      enabled,
      wakeCondition: sub.wakeCondition,
      freshnessPolicy: sub.freshnessPolicy,
    });
  };

  /** Stable Dashboard handoff: no projections or copied Goal points. */
  list = async (goalId: string) =>
    this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const goal = await this.goal(db, goalId);
      const rows = await db
        .select()
        .from(goalSubscriptions)
        .where(eq(goalSubscriptions.goalId, goalId))
        .orderBy(asc(goalSubscriptions.id));
      return Promise.all(
        rows.map(async (subscription) => {
          const source = await this.source(db, subscription, goal.userId).catch(() => undefined);
          const model = new MetricModel(db, goal.userId, this.workspaceId);
          const trend = source?.metric
            ? await model.listPoints(source.metric.id, { limit: 200 })
            : undefined;
          const [latestRun] = source
            ? await db
                .select()
                .from(widgetRuns)
                .where(
                  and(
                    eq(widgetRuns.widgetId, subscription.widgetId),
                    sql`${widgetRuns.trigger} <> 'preview'`,
                  ),
                )
                .orderBy(desc(widgetRuns.createdAt), desc(widgetRuns.id))
                .limit(1)
            : [];
          const [latestSuccessfulRun] = source
            ? await db
                .select()
                .from(widgetRuns)
                .where(
                  and(
                    eq(widgetRuns.widgetId, subscription.widgetId),
                    eq(widgetRuns.versionId, subscription.confirmedVersionId),
                    eq(widgetRuns.status, 'succeeded'),
                    sql`${widgetRuns.trigger} <> 'preview'`,
                  ),
                )
                .orderBy(desc(widgetRuns.createdAt), desc(widgetRuns.id))
                .limit(1)
            : [];
          const [latestFailureRun] = source
            ? await db
                .select()
                .from(widgetRuns)
                .where(
                  and(
                    eq(widgetRuns.widgetId, subscription.widgetId),
                    sql`${widgetRuns.status} IN ('failed', 'timeout', 'partial')`,
                    sql`${widgetRuns.trigger} <> 'preview'`,
                  ),
                )
                .orderBy(desc(widgetRuns.createdAt), desc(widgetRuns.id))
                .limit(1)
            : [];
          const point = source ? await this.acceptedPoint(db, subscription) : undefined;
          const clause = goal.config?.acceptance?.metrics?.find(
            (c) => c.key === subscription.binding.criterionKey,
          );
          const eligible =
            subscription.enabled &&
            ['planning', 'running'].includes(goal.status) &&
            !!point &&
            Number.isFinite(point.value) &&
            freshObservation(point.observedAt, subscription.freshnessPolicy, Date.now());
          const progress = clause
            ? {
                criterionKey: clause.key,
                value: point?.value ?? null,
                observedAt: point?.observedAt,
                eligible,
                target: clause.target,
                op: clause.op ?? 'gte',
                met:
                  eligible &&
                  subscriptionWakes(
                    { type: 'threshold', op: clause.op ?? 'gte', target: clause.target },
                    point?.value,
                    undefined,
                    undefined,
                    Date.now(),
                  ),
              }
            : undefined;
          return {
            subscription,
            widget: source?.widget,
            metric: source?.metric,
            trend: trend?.points ?? [],
            latestRun,
            latestSuccessfulRun,
            latestFailureRun,
            progress,
            latestSuccessfulObservation: point,
            fresh:
              !!point &&
              freshObservation(point.observedAt, subscription.freshnessPolicy, Date.now()),
            sourceAvailable: !!source,
            goal: {
              id: goal.id,
              status: goal.status,
              managerState: goal.config?.managerState,
              acceptance: goal.config?.acceptance,
            },
          };
        }),
      );
    });

  private async acceptedPoint(db: LobeChatDatabase, sub: GoalSubscriptionRow) {
    if (!sub.metricId || !sub.cursor.observation) return undefined;
    const [point] = await db
      .select()
      .from(metricPoints)
      .innerJoin(widgetRuns, sql`${widgetRuns.id}::text = ${metricPoints.actorId}`)
      .where(
        and(
          eq(metricPoints.id, sub.cursor.observation.pointId),
          eq(metricPoints.metricId, sub.metricId),
          eq(metricPoints.userId, widgetRuns.userId),
          sql`${metricPoints.workspaceId} IS NOT DISTINCT FROM ${widgetRuns.workspaceId}`,
          eq(metricPoints.actorType, 'system'),
          eq(metricPoints.sourceType, 'probe'),
          eq(widgetRuns.widgetId, sub.widgetId),
          eq(widgetRuns.versionId, sub.confirmedVersionId),
          eq(widgetRuns.status, 'succeeded'),
          sql`${widgetRuns.trigger} <> 'preview'`,
          sql`COALESCE(${widgetRuns.output}->'meta'->>'complete', 'true') <> 'false'`,
        ),
      );
    return point?.metric_points;
  }

  /** Numeric acceptance reads only the committed, still fresh authoritative point. */
  criterion = async (goalId: string, key: string) =>
    this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const goal = await this.goal(db, goalId);
      const rows = await db
        .select()
        .from(goalSubscriptions)
        .where(
          and(
            eq(goalSubscriptions.goalId, goalId),
            sql`${goalSubscriptions.binding}->>'criterionKey' = ${key}`,
          ),
        )
        .for('update');
      if (!rows.length) return { bound: false as const, point: undefined };
      const sub = rows[0];
      if (
        rows.length !== 1 ||
        sub.userId !== goal.userId ||
        sub.workspaceId !== goal.workspaceId ||
        !sub.enabled ||
        !['planning', 'running'].includes(goal.status)
      )
        return { bound: true as const, point: undefined };
      await db
        .select({ id: widgets.id })
        .from(widgets)
        .where(eq(widgets.id, sub.widgetId))
        .for('update');
      const source = await this.source(db, sub, goal.userId).catch(() => undefined);
      if (!source) return { bound: true as const, point: undefined };
      const point = await this.acceptedPoint(db, sub);
      return {
        bound: true as const,
        point:
          point &&
          Number.isFinite(point.value) &&
          freshObservation(point.observedAt, sub.freshnessPolicy, Date.now())
            ? point
            : undefined,
      };
    });

  criteria = async (goalId: string, keys: string[]) => {
    if (!keys.length)
      return new Map<string, Awaited<ReturnType<GoalSubscriptionService['criterion']>>>();
    return this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      await this.goal(db, goalId);
      const rows = await db
        .select()
        .from(goalSubscriptions)
        .where(eq(goalSubscriptions.goalId, goalId));
      const ids = [
        ...new Set(
          rows
            .filter((sub) => sub.binding.criterionKey && keys.includes(sub.binding.criterionKey))
            .map((sub) => sub.widgetId),
        ),
      ].sort();
      // All bound sources lock in one global order, including final achievement.
      // Two Goals with inverse clause orders cannot deadlock on shared Widgets.
      if (ids.length)
        await db
          .select({ id: widgets.id })
          .from(widgets)
          .where(inArray(widgets.id, ids))
          .orderBy(asc(widgets.id))
          .for('update');
      const service = new GoalSubscriptionService(db, this.userId, this.workspaceId);
      const result = new Map<string, Awaited<ReturnType<GoalSubscriptionService['criterion']>>>();
      for (const key of keys) result.set(key, await service.criterion(goalId, key));
      return result;
    });
  };

  /** Unmanaged Goals acknowledge the same durable pending coordination effect on tick. */
  acknowledge = async (goalId: string) =>
    this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const goal = await this.goal(db, goalId);
      if (goal.config?.manager || !['planning', 'running'].includes(goal.status)) return;
      const rows = await db
        .select()
        .from(goalSubscriptions)
        .where(and(eq(goalSubscriptions.goalId, goalId), eq(goalSubscriptions.enabled, true)))
        .for('update');
      const now = Date.now();
      for (const sub of rows) {
        if (
          !sub.cursor.pendingWake ||
          now <
            Date.parse(sub.cursor.lastWakeAt ?? new Date(now).toISOString()) +
              planningInterval(sub.wakeCondition)
        )
          continue;
        await db
          .update(goalSubscriptions)
          .set({
            cursor: { ...sub.cursor, pendingWake: false, lastWakeAt: new Date(now).toISOString() },
            updatedAt: new Date(),
          })
          .where(eq(goalSubscriptions.id, sub.id));
      }
    });

  consume = async (id: string, revision?: number) => {
    const wake = await this.db.transaction(async (tx) => {
      const db = tx as unknown as LobeChatDatabase;
      const [hint] = await db.select().from(goalSubscriptions).where(eq(goalSubscriptions.id, id));
      if (!hint) return;
      const goal = await this.goal(db, hint.goalId);
      if (goal.userId !== hint.userId || goal.workspaceId !== hint.workspaceId) throw unavailable();
      // Widget lock closes late-reservation gaps; consistent goal→widget→subscription order.
      await db
        .select({ id: widgets.id })
        .from(widgets)
        .where(eq(widgets.id, hint.widgetId))
        .for('update');
      const [sub] = await db
        .select()
        .from(goalSubscriptions)
        .where(eq(goalSubscriptions.id, id))
        .for('update');
      if (!sub?.enabled || (revision !== undefined && revision !== sub.bindingRevision)) return;
      if (!['planning', 'running'].includes(goal.status)) {
        await db
          .update(goalSubscriptions)
          .set({ enabled: false, bindingRevision: sub.bindingRevision + 1, updatedAt: new Date() })
          .where(eq(goalSubscriptions.id, id));
        return;
      }
      const source = await this.source(db, sub, goal.userId);
      const cursor = { ...sub.cursor };
      const now = Date.now();
      const previous = await this.acceptedPoint(db, sub);
      let shouldWake =
        cursor.pendingWake === true ||
        (sub.wakeCondition.type === 'observation_window' &&
          subscriptionWakes(sub.wakeCondition, undefined, undefined, cursor.lastWakeAt, now));
      const runs = await db
        .select({ run: widgetRuns, position: instant(widgetRuns.createdAt) })
        .from(widgetRuns)
        .where(
          and(
            eq(widgetRuns.widgetId, sub.widgetId),
            cursor.run
              ? sql`(${widgetRuns.createdAt}, ${widgetRuns.id}) > (${cursor.run.createdAt}::timestamptz, ${cursor.run.runId}::uuid)`
              : undefined,
          ),
        )
        .orderBy(asc(widgetRuns.createdAt), asc(widgetRuns.id))
        .limit(100);
      for (const { run, position } of runs) {
        if (run.status === 'running') break;
        let valid = false;
        let value: number | undefined;
        if (
          run.userId === source.widget.userId &&
          run.workspaceId === sub.workspaceId &&
          run.trigger !== 'preview' &&
          run.versionId === sub.confirmedVersionId &&
          run.status === 'succeeded' &&
          run.output?.meta?.complete !== false
        ) {
          if (!sub.metricId)
            valid = !!run.finishedAt && freshObservation(run.finishedAt, sub.freshnessPolicy, now);
          else {
            const points = await db
              .select({ point: metricPoints, position: instant(metricPoints.observedAt) })
              .from(metricPoints)
              .where(
                and(
                  eq(metricPoints.metricId, sub.metricId),
                  eq(metricPoints.actorId, run.id),
                  eq(metricPoints.actorType, 'system'),
                  eq(metricPoints.sourceType, 'probe'),
                  eq(metricPoints.userId, source.widget.userId),
                  sql`${metricPoints.workspaceId} IS NOT DISTINCT FROM ${sub.workspaceId}`,
                  cursor.observation
                    ? sql`(${metricPoints.observedAt}, ${metricPoints.id}) > (${cursor.observation.observedAt}::timestamptz, ${cursor.observation.pointId}::uuid)`
                    : undefined,
                ),
              )
              .orderBy(asc(metricPoints.observedAt), asc(metricPoints.id));
            for (const { point, position: observedAt } of points) {
              if (
                !Number.isFinite(point.value) ||
                !freshObservation(observedAt, sub.freshnessPolicy, now)
              )
                continue;
              cursor.observation = { observedAt, pointId: point.id };
              value = point.value;
              valid = true;
            }
          }
        }
        if (
          valid &&
          subscriptionWakes(sub.wakeCondition, value, previous?.value, cursor.lastWakeAt, now)
        )
          shouldWake = true;
        cursor.run = { createdAt: position, runId: run.id };
      }
      cursor.pendingWake = shouldWake;
      const state = goal.config?.managerState;
      const graph = shouldWake
        ? await new GoalGraphModel(db, goal.userId, this.workspaceId).getGraph(goal.id)
        : undefined;
      const readyAt =
        Date.parse(cursor.lastWakeAt ?? new Date(now).toISOString()) +
        planningInterval(sub.wakeCondition);
      const ready = now >= readyAt;
      if (
        shouldWake &&
        ready &&
        state?.consumed &&
        state.wait &&
        !state.wait.wake &&
        !graph?.decisions.some((d) => d.status === 'pending')
      ) {
        cursor.lastWakeAt = new Date(now).toISOString();
        cursor.pendingWake = false;
        const next = {
          ...state,
          wait: {
            ...state.wait,
            wake: {
              at: cursor.lastWakeAt,
              cause: 'event' as const,
              eventId: `widget:${sub.id}:${sub.bindingRevision}:${cursor.run?.runId ?? 'window'}`,
              reference: sub.widgetId,
              summary: 'Widget observation boundary reached',
            },
          },
        };
        await db
          .update(goals)
          .set({
            config: sql`jsonb_set(COALESCE(${goals.config}, '{}'::jsonb), '{managerState}', ${JSON.stringify(next)}::jsonb)`,
          })
          .where(eq(goals.id, goal.id));
      }
      await db
        .update(goalSubscriptions)
        .set({ cursor, updatedAt: new Date() })
        .where(eq(goalSubscriptions.id, id));
      // Durable wait.wake survives dispatch failure; sweep resends until advance consumes it.
      return (state?.wait && (state.wait.wake || shouldWake)) ||
        (!goal.config?.manager && shouldWake)
        ? {
            goalId: goal.id,
            delay: state?.wait?.wake || ready ? 0 : Math.max(1, Math.ceil((readyAt - now) / 1000)),
          }
        : undefined;
    });
    if (wake)
      await scheduleGoalAdvance({
        ...wake,
        userId: this.userId,
        workspaceId: this.workspaceId,
        trigger: 'wake',
      });
  };

  static async forWidget(db: LobeChatDatabase, widgetId: string) {
    const subs = await db
      .select()
      .from(goalSubscriptions)
      .where(and(eq(goalSubscriptions.widgetId, widgetId), eq(goalSubscriptions.enabled, true)))
      .limit(100);
    for (const sub of subs)
      await new GoalSubscriptionService(db, sub.userId, sub.workspaceId ?? undefined)
        .consume(sub.id, sub.bindingRevision)
        .catch((error) =>
          console.error('[goal:subscription] completion scan failed', sub.id, error),
        );
  }

  static async forGoal(db: LobeChatDatabase, goalId: string) {
    const subs = await db
      .select()
      .from(goalSubscriptions)
      .where(and(eq(goalSubscriptions.goalId, goalId), eq(goalSubscriptions.enabled, true)));
    for (const sub of subs)
      await new GoalSubscriptionService(db, sub.userId, sub.workspaceId ?? undefined).consume(
        sub.id,
        sub.bindingRevision,
      );
  }

  /** Bounded cyclic pass. Stable UUID ordering; scheduling never depends on notification delivery. */
  static async reconcile(db: LobeChatDatabase, after?: string, limit = 100) {
    const rows = await db
      .select()
      .from(goalSubscriptions)
      .where(
        and(
          eq(goalSubscriptions.enabled, true),
          after ? sql`${goalSubscriptions.id} > ${after}::uuid` : undefined,
        ),
      )
      .orderBy(asc(goalSubscriptions.id))
      .limit(limit);
    for (const sub of rows)
      await new GoalSubscriptionService(db, sub.userId, sub.workspaceId ?? undefined)
        .consume(sub.id, sub.bindingRevision)
        .catch((error) => console.error('[goal:subscription] reconcile failed', sub.id, error));
    return rows.length === limit ? rows.at(-1)?.id : undefined;
  }
}

export type GoalSubscriptionRead = Awaited<ReturnType<GoalSubscriptionService['list']>>[number];
