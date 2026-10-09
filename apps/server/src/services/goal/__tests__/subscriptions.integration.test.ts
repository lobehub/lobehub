// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { GoalModel } from '@/database/models/goal';
import { MetricModel } from '@/database/models/metric';
import { WidgetModel } from '@/database/models/widget';
import {
  goalSubscriptions,
  goals,
  metricPoints,
  users,
  widgetRuns,
  widgets,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { executeWidgetRun } from '../../widget/executeRun';
import { recordWidgetMetrics } from '../../widget/metrics';
import { GoalSubscriptionService } from '../subscriptions';
import { scheduleGoalAdvance } from '../scheduler';

vi.mock('../scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

let db: LobeChatDatabase;
let owner: string;
let other: string;
let service: GoalSubscriptionService;
let model: WidgetModel;
const policy = {
  freshnessPolicy: { maxAgeMs: 60_000, maxFutureSkewMs: 0 },
  wakeCondition: { type: 'each_valid_run' as const },
};

beforeEach(async () => {
  db = await getTestDB();
  owner = `subscription-${randomUUID()}`;
  other = `subscription-${randomUUID()}`;
  await db.insert(users).values([{ id: owner }, { id: other }]);
  service = new GoalSubscriptionService(db, owner);
  model = new WidgetModel(db, owner);
});
afterEach(async () => {
  await db.delete(users).where(sql`${users.id} IN (${owner}, ${other})`);
  vi.restoreAllMocks();
});

const fixture = async () => {
  const widget = await model.create({
    title: 'Authoritative collection',
    schedulePattern: '* * * * *',
  });
  const version = await model.createVersion(widget.id, {
    outputType: 'stat',
    runtime: 'node',
    script: 'console.log(JSON.stringify({type:"stat",value:7}))',
    sourceType: 'agent',
  });
  await model.publishVersion(widget.id, version!.id);
  const run = await model.startRun(widget.id, { trigger: 'manual' });
  await executeWidgetRun(
    db,
    { run: run!, widget, version: version! },
    {
      runner: {
        run: async () => ({
          durationMs: 1,
          exitCode: 0,
          stderr: '',
          stdout: '{"type":"stat","value":7}',
          timedOut: false,
        }),
      },
    },
  );
  const metric = await new MetricModel(db, owner).findByKey('widget', widget.id, 'value');
  const [goal] = await db
    .insert(goals)
    .values({
      userId: owner,
      title: 'Collection goal',
      status: 'running',
      config: { acceptance: { metrics: [{ key: 'followers', target: 8 }] } },
    })
    .returning();
  const sub = await service.bind({
    ...policy,
    goalId: goal.id,
    widgetId: widget.id,
    metricId: metric!.id,
    criterionKey: 'followers',
    confirmedVersionId: version!.id,
    confirmedContentHash: version!.contentHash,
  });
  const enabled = await service.update({
    ...policy,
    id: sub.id,
    bindingRevision: sub.bindingRevision,
    enabled: true,
  });
  return { widget, version: version!, metric: metric!, goal, sub: enabled };
};
const reserve = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await model.startRun(f.widget.id, { trigger: 'manual' }))!;
const finish = async (
  f: Awaited<ReturnType<typeof fixture>>,
  run: Awaited<ReturnType<typeof reserve>>,
  status: 'succeeded' | 'failed' | 'timeout' | 'partial' = 'succeeded',
  value = 8,
) =>
  WidgetModel.finishRun(
    db,
    run.id,
    {
      status,
      output: { type: 'stat', value, ...(status === 'partial' && { meta: { complete: false } }) },
    },
    async (tx, completed) => {
      await recordWidgetMetrics(tx as unknown as LobeChatDatabase, f.widget, {
        runId: run.id,
        manifest: f.version.manifest,
        observedAt: completed.finishedAt!,
        output: { type: 'stat', value },
      });
    },
  );

describe('durable Widget to Goal subscriptions', () => {
  it('defaults disabled, rejects foreign owners and duplicate criterion mapping', async () => {
    const f = await fixture();
    await expect(new GoalSubscriptionService(db, other).list(f.goal.id)).rejects.toThrow();
    await expect(
      service.bind({
        ...policy,
        goalId: f.goal.id,
        widgetId: f.widget.id,
        metricId: null,
        criterionKey: 'followers',
        confirmedVersionId: f.version.id,
        confirmedContentHash: f.version.contentHash,
      }),
    ).rejects.toThrow();
    const result = await service.bind({
      ...policy,
      goalId: f.goal.id,
      widgetId: f.widget.id,
      metricId: null,
      confirmedVersionId: f.version.id,
      confirmedContentHash: f.version.contentHash,
    });
    expect(result.enabled).toBe(false);
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
  });

  it('persists early observations, dedupes duplicate hints, stops at running barriers and reconciles missed completions after restart', async () => {
    const f = await fixture();
    const early = await reserve(f);
    await service.consume(f.sub.id); // early hint while producer still running
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    await finish(f, early);
    await service.consume(f.sub.id);
    const first = (await service.list(f.goal.id))[0].subscription.cursor;
    expect(first.pendingWake).toBe(true);
    await service.consume(f.sub.id); // duplicate
    expect((await service.list(f.goal.id))[0].subscription.cursor).toEqual(first);
    const slow = await reserve(f);
    const fast = await reserve(f);
    await finish(f, fast, 'succeeded', 9);
    await service.consume(f.sub.id); // out-of-order finalization cannot skip slow
    expect((await service.list(f.goal.id))[0].subscription.cursor.run?.runId).toBe(early.id);
    await finish(f, slow, 'failed');
    await GoalSubscriptionService.reconcile(db); // fresh instance, lost notification
    expect((await service.list(f.goal.id))[0].subscription.cursor.run?.runId).toBe(fast.id);
    expect((await service.criterion(f.goal.id, 'followers')).point?.value).toBe(9);
  });

  it.each(['failed', 'timeout', 'partial'] as const)(
    'does not achieve from %s sampling',
    async (status) => {
      const f = await fixture();
      const run = await reserve(f);
      await finish(f, run, status, 999);
      await service.consume(f.sub.id);
      expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
      expect((await service.list(f.goal.id))[0].latestRun?.status).toBe(status);
    },
  );

  it('rolls back run success and metric points on publication failure', async () => {
    const f = await fixture();
    const run = await reserve(f);
    await expect(
      WidgetModel.finishRun(
        db,
        run.id,
        { status: 'succeeded', output: { type: 'stat', value: 999 } },
        async (tx, completed) => {
          await recordWidgetMetrics(tx as unknown as LobeChatDatabase, f.widget, {
            runId: run.id,
            observedAt: completed.finishedAt!,
            output: { type: 'stat', value: 999 },
          });
          throw new Error('storage failed');
        },
      ),
    ).rejects.toThrow('storage failed');
    const [stored] = await db.select().from(widgetRuns).where(eq(widgetRuns.id, run.id));
    expect(stored.status).toBe('running');
    expect(
      await db.select().from(metricPoints).where(eq(metricPoints.actorId, run.id)),
    ).toHaveLength(0);
    await service.consume(f.sub.id);
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
  });

  it('re-evaluates freshness at acceptance and refuses future, stale or older observations', async () => {
    const f = await fixture();
    const run = await reserve(f);
    await finish(f, run);
    await service.consume(f.sub.id);
    const point = (await service.criterion(f.goal.id, 'followers')).point!;
    expect(point.value).toBe(8);
    await db
      .update(metricPoints)
      .set({ observedAt: new Date(Date.now() - 120_000) })
      .where(eq(metricPoints.id, point.id));
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    await db
      .update(metricPoints)
      .set({ observedAt: new Date(Date.now() + 120_000) })
      .where(eq(metricPoints.id, point.id));
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
  });

  it.each(['paused', 'canceled', 'achieved'] as const)(
    'atomically stops %s Goal consumption while shared Widget collection continues',
    async (status) => {
      const f = await fixture();
      const second = await db
        .insert(goals)
        .values({ userId: owner, title: 'Other Goal', status: 'running' })
        .returning();
      const otherBinding = await service.bind({
        ...policy,
        goalId: second[0].id,
        widgetId: f.widget.id,
        metricId: f.metric.id,
        confirmedVersionId: f.version.id,
        confirmedContentHash: f.version.contentHash,
      });
      await service.update({ ...policy, id: otherBinding.id, bindingRevision: 1, enabled: true });
      await new GoalModel(db, owner).updateStatus(f.goal.id, status);
      const stopped = (await service.list(f.goal.id))[0].subscription;
      expect(stopped.enabled).toBe(false);
      expect(stopped.cursor.pendingWake).toBeUndefined();
      expect(stopped.bindingRevision).toBe(f.sub.bindingRevision + 1);
      const run = await reserve(f);
      await finish(f, run);
      await GoalSubscriptionService.forWidget(db, f.widget.id);
      expect((await service.list(second[0].id))[0].subscription.cursor.run?.runId).toBe(run.id);
      const [stillShared] = await db.select().from(widgets).where(eq(widgets.id, f.widget.id));
      expect(stillShared.schedulePattern).toBe('* * * * *');
    },
  );

  it('explicit rebind fences old callbacks and establishes a non-replay baseline', async () => {
    const f = await fixture();
    const run = await reserve(f);
    await finish(f, run);
    await service.consume(f.sub.id);
    const rebound = await service.bind(
      {
        ...policy,
        goalId: f.goal.id,
        widgetId: f.widget.id,
        metricId: f.metric.id,
        criterionKey: 'followers',
        confirmedVersionId: f.version.id,
        confirmedContentHash: f.version.contentHash,
      },
      { id: f.sub.id, bindingRevision: f.sub.bindingRevision },
    );
    expect(rebound.enabled).toBe(false);
    expect(rebound.cursor.observation).toBeUndefined();
    await service.consume(rebound.id, f.sub.bindingRevision);
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    await expect(
      service.update({
        ...policy,
        id: rebound.id,
        bindingRevision: f.sub.bindingRevision,
        enabled: true,
      }),
    ).rejects.toThrow('Binding revision');
    await expect(
      new MetricModel(db, owner).update(f.metric.id, { unit: 'different account' }),
    ).rejects.toThrow('immutable');
  });

  it('preserves PostgreSQL submillisecond tuples and does not regress progress from older points', async () => {
    const f = await fixture();
    const run = await reserve(f);
    await finish(f, run);
    await db.execute(
      sql`UPDATE widget_runs SET created_at = '2100-01-01T00:00:00.123456Z'::timestamptz WHERE id = ${run.id}::uuid`,
    );
    await db.execute(
      sql`UPDATE metric_points SET observed_at = clock_timestamp() - interval '10 seconds' WHERE actor_id = ${run.id}`,
    );
    await service.consume(f.sub.id);
    const cursor = (await service.list(f.goal.id))[0].subscription.cursor;
    expect(cursor.run?.createdAt).toBe('2100-01-01T00:00:00.123456Z');
    const later = await reserve(f);
    await finish(f, later, 'succeeded', 1);
    await db.execute(
      sql`UPDATE widget_runs SET created_at = '2100-01-01T00:00:00.123457Z'::timestamptz WHERE id = ${later.id}::uuid`,
    );
    await db.execute(
      sql`UPDATE metric_points SET observed_at = clock_timestamp() - interval '20 seconds' WHERE actor_id = ${later.id}`,
    );
    await service.consume(f.sub.id);
    expect((await service.criterion(f.goal.id, 'followers')).point?.value).toBe(8);
    expect((await service.list(f.goal.id))[0].subscription.cursor.run?.runId).toBe(later.id);
  });

  it('rejects preview runs and soft-deleted source access after binding', async () => {
    const f = await fixture();
    const preview = (await model.startRun(f.widget.id, { trigger: 'preview' }))!;
    await finish(f, preview, 'succeeded', 999);
    await service.consume(f.sub.id);
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    const run = await reserve(f);
    await finish(f, run);
    await service.consume(f.sub.id);
    await db.update(widgets).set({ isDeleted: true }).where(eq(widgets.id, f.widget.id));
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    expect((await service.list(f.goal.id))[0].sourceAvailable).toBe(false);
  });

  it('rejects changed script/account semantics on the existing metric key', async () => {
    const f = await fixture();
    const changed = await model.createVersion(f.widget.id, {
      outputType: 'stat',
      runtime: 'node',
      sourceType: 'agent',
      script: 'console.log(JSON.stringify({type:"stat",value:999}))',
    });
    await model.publishVersion(f.widget.id, changed!.id);
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
    const run = await reserve(f);
    const failed = await executeWidgetRun(
      db,
      { run, widget: f.widget, version: changed! },
      {
        runner: {
          run: async () => ({
            durationMs: 1,
            exitCode: 0,
            stderr: '',
            stdout: '{"type":"stat","value":999}',
            timedOut: false,
          }),
        },
      },
    );
    expect(failed?.status).toBe('failed');
    expect(failed?.error?.code).toBe('METRIC_PUBLICATION_FAILED');
    expect(
      await db.select().from(metricPoints).where(eq(metricPoints.actorId, run.id)),
    ).toHaveLength(0);
  });

  it('buffers frequent samples and atomically commits a retryable current-wait wake', async () => {
    const f = await fixture();
    const state = {
      consumed: true,
      token: 'current-wait',
      topicId: 'tpc_test',
      turns: 1,
      snapshot: 'test',
      startedAt: new Date().toISOString(),
      wait: { until: new Date(Date.now() + 120_000).toISOString() },
    };
    await db
      .update(goals)
      .set({ config: { ...f.goal.config, manager: {}, managerState: state } })
      .where(eq(goals.id, f.goal.id));
    const run = await reserve(f);
    await finish(f, run);
    await service.consume(f.sub.id);
    let [stored] = await db.select().from(goals).where(eq(goals.id, f.goal.id));
    expect(stored.config?.managerState?.wait?.wake).toBeUndefined();
    const cursor = (await service.list(f.goal.id))[0].subscription.cursor;
    expect(cursor.pendingWake).toBe(true);
    await db
      .update(goalSubscriptions)
      .set({ cursor: { ...cursor, lastWakeAt: new Date(Date.now() - 61_000).toISOString() } })
      .where(eq(goalSubscriptions.id, f.sub.id));
    vi.mocked(scheduleGoalAdvance).mockRejectedValueOnce(new Error('lost dispatch'));
    await expect(service.consume(f.sub.id)).rejects.toThrow('lost dispatch');
    [stored] = await db.select().from(goals).where(eq(goals.id, f.goal.id));
    const wake = stored.config?.managerState?.wait?.wake;
    expect(wake?.eventId).toContain(`:${f.sub.bindingRevision}:${run.id}`);
    await new GoalSubscriptionService(db, owner).consume(f.sub.id); // restart / retry
    [stored] = await db.select().from(goals).where(eq(goals.id, f.goal.id));
    expect(stored.config?.managerState?.wait?.wake).toEqual(wake);
  });

  it('creates an observation-window fallback wake without new samples', async () => {
    const f = await fixture();
    const row = await service.update({
      ...policy,
      id: f.sub.id,
      bindingRevision: f.sub.bindingRevision,
      enabled: true,
      wakeCondition: { type: 'observation_window', intervalMs: 1000 },
    });
    await db
      .update(goalSubscriptions)
      .set({ cursor: { ...row.cursor, lastWakeAt: new Date(Date.now() - 2000).toISOString() } })
      .where(eq(goalSubscriptions.id, row.id));
    await db
      .update(goals)
      .set({
        config: {
          ...f.goal.config,
          manager: {},
          managerState: {
            consumed: true,
            token: 'window',
            topicId: 'tpc_test',
            turns: 1,
            snapshot: 'test',
            startedAt: new Date().toISOString(),
            wait: { until: new Date(Date.now() + 120_000).toISOString() },
          },
        },
      })
      .where(eq(goals.id, f.goal.id));
    await service.consume(row.id, row.bindingRevision);
    const [goal] = await db.select().from(goals).where(eq(goals.id, f.goal.id));
    expect(goal.config?.managerState?.wait?.wake?.cause).toBe('event');
    expect((await service.criterion(f.goal.id, 'followers')).point).toBeUndefined();
  });

  it('checks workspace membership and both actor and Goal owner read access', async () => {
    const ws = `ws-${randomUUID()}`;
    await db
      .insert(workspaces)
      .values({ id: ws, name: 'Subscriptions', slug: ws, primaryOwnerId: owner });
    try {
      await db.insert(workspaceMembers).values({ workspaceId: ws, userId: owner, role: 'owner' });
      const [goal] = await db
        .insert(goals)
        .values({ userId: owner, workspaceId: ws, title: 'Workspace Goal', status: 'running' })
        .returning();
      await expect(new GoalSubscriptionService(db, other, ws).list(goal.id)).rejects.toThrow();
      await db.insert(workspaceMembers).values({ workspaceId: ws, userId: other, role: 'member' });
      expect(await new GoalSubscriptionService(db, other, ws).list(goal.id)).toEqual([]);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws));
    }
  });
});
