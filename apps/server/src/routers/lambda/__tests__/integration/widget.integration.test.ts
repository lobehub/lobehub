// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  metricPoints,
  metrics,
  projects,
  topics,
  widgetRuns,
  widgets,
  widgetVersions,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { DashboardModel } from '@/database/models/dashboard';
import { WidgetModel } from '@/database/models/widget';
import { qstashClient } from '@/libs/qstash';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import widgetWorkflowApp from '@/server/router-hono/workflows/widget';
import { executeWidgetRun } from '@/server/services/widget/executeRun';
import { recordWidgetMetrics } from '@/server/services/widget/metrics';
import { runWidgetSchedulerTick } from '@/server/services/widget/scheduler';

import { dashboardRouter } from '../../dashboard';
import { metricRouter } from '../../metric';
import { widgetRouter } from '../../widget';
import { cleanupTestUser, createTestAgent, createTestUser } from './setup';

vi.hoisted(() => {
  // 32-byte key so connector credentials round-trip through the real gatekeeper.
  process.env.KEY_VAULTS_SECRET = Buffer.alloc(32, 7).toString('base64');
});

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const queueMode = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/envs/app', async (importOriginal) => {
  const mod = await importOriginal<{ appEnv: object }>();
  return {
    ...mod,
    appEnv: new Proxy(mod.appEnv, {
      get: (target, key) =>
        key === 'enableQueueAgentRuntime' ? queueMode.enabled : Reflect.get(target, key),
    }),
  };
});

const runSandbox = vi.fn();
vi.mock('@/server/services/widget/sandbox', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createWidgetSandboxRunner: () => ({ run: runSandbox }),
}));

const ok = (output: unknown) => ({
  durationMs: 12,
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(output),
  timedOut: false,
});

const statScript = {
  outputType: 'stat' as const,
  runtime: 'node' as const,
  script: `console.log(JSON.stringify({ type: 'stat', value: 7 }))`,
};

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('widget + dashboard routers integration', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  let workspaceId: string;

  beforeEach(async () => {
    runSandbox.mockReset();
    db = await getTestDB();
    testDB = db;
    [ownerId, memberId, outsiderId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Dashboards', primaryOwnerId: ownerId, slug: `db-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    queueMode.enabled = false;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, memberId, outsiderId].map((id) => cleanupTestUser(db, id)));
  });

  type WidgetCaller = ReturnType<typeof widgetRouter.createCaller>;
  const callers = (userId: string, ws?: string) => ({
    board: dashboardRouter.createCaller(context(userId, ws)),
    widget: widgetRouter.createCaller(context(userId, ws)),
  });

  const createWidget = async (
    caller: WidgetCaller,
    input: Parameters<WidgetCaller['create']>[0] = { title: 'Open PRs' },
  ) => (await caller.create(input))!.data;

  describe('version flow', () => {
    it('requires a successful dry run of the exact content before publishing', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner);

      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      expect(draft).toMatchObject({ status: 'draft', version: 1 });

      await expect(
        owner.publish({ versionId: draft.id, widgetId: widget.id }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });

      // A failing dry run does not unlock publishing either.
      runSandbox.mockResolvedValueOnce({ ...ok({}), exitCode: 1, stderr: 'boom' });
      const failed = (await owner.dryRun({ widgetId: widget.id }))!.data;
      expect(failed).toMatchObject({
        error: { code: 'NON_ZERO_EXIT', message: 'Script exited with code 1: boom' },
        status: 'failed',
        trigger: 'preview',
      });
      await expect(
        owner.publish({ versionId: draft.id, widgetId: widget.id }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 7 }));
      const preview = (await owner.dryRun({ widgetId: widget.id }))!.data;
      expect(preview).toMatchObject({ output: { type: 'stat', value: 7 }, status: 'succeeded' });

      // Preview runs never touch the live snapshot.
      const [afterPreview] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
      expect(afterPreview).toMatchObject({ lastRunId: null, latestOutput: null });

      // Saving identical content reuses the draft (same content hash).
      const again = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      expect(again.id).toBe(draft.id);

      const published = (await owner.publish({ versionId: draft.id, widgetId: widget.id }))!.data;
      expect(published.widget).toMatchObject({
        draftVersionId: null,
        publishedVersionId: draft.id,
      });
    });

    it('reports the widget’s versions and the boards it is placed on', async () => {
      const { board: ownerBoard, widget: owner } = callers(ownerId);
      const board = (await ownerBoard.create({ title: 'Ops' }))!.data;
      const widget = await createWidget(owner, { dashboardId: board.id, title: 'Open PRs' });
      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;

      const detail = (await owner.detail({ id: widget.id }))!.data;
      expect(detail).toMatchObject({
        dashboards: [{ id: board.id, title: 'Ops' }],
        draftVersion: { id: draft.id },
        publishedVersion: null,
      });

      await ownerBoard.trash({ id: board.id });
      expect((await owner.detail({ id: widget.id }))!.data.dashboards).toEqual([]);
    });

    it('publishes v2 over v1 and rolls back to the archived v1', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner);
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 1 }));

      const v1 = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: v1.id, widgetId: widget.id });

      const v2 = (await owner.saveDraft({
        changeNote: 'count drafts too',
        widgetId: widget.id,
        ...statScript,
        script: `console.log(JSON.stringify({ type: 'stat', value: 8 }))`,
      }))!.data;
      expect(v2.version).toBe(2);
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: v2.id, widgetId: widget.id });

      const versions = (await owner.listVersions({ widgetId: widget.id }))!.data;
      expect(versions.map((v) => [v.version, v.status])).toEqual([
        [2, 'published'],
        [1, 'archived'],
      ]);

      // A draft that never went live is not a rollback target.
      const v3 = (await owner.saveDraft({
        widgetId: widget.id,
        ...statScript,
        script: 'console.log(3)',
      }))!.data;
      await expect(owner.rollback({ versionId: v3.id, widgetId: widget.id })).rejects.toMatchObject(
        {
          code: 'BAD_REQUEST',
        },
      );

      const rolled = (await owner.rollback({ widgetId: widget.id }))!.data;
      expect(rolled.widget.publishedVersionId).toBe(v1.id);
      const after = (await owner.listVersions({ widgetId: widget.id }))!.data;
      expect(after.map((v) => [v.version, v.status])).toEqual([
        [3, 'draft'],
        [2, 'archived'],
        [1, 'published'],
      ]);
    });
  });

  describe('runs', () => {
    const publishStat = async (owner: WidgetCaller, extra = {}) => {
      const widget = await createWidget(owner, { title: 'Stars', ...extra });
      const draft = (await owner.saveDraft({
        manifest: { metric: { key: 'stars', unit: 'stars' } },
        widgetId: widget.id,
        ...statScript,
      }))!.data;
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });
      return widget;
    };

    it('stores the output, records a metric point, and keeps it through failures', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await publishStat(owner);

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 42 }));
      const run = (await owner.run({ widgetId: widget.id }))!.data;
      expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual' });

      let [row] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
      expect(row).toMatchObject({
        consecutiveFailures: 0,
        lastRunStatus: 'succeeded',
        latestOutput: { type: 'stat', value: 42 },
      });
      expect(row.metricId).toBeTruthy();
      const points = await db
        .select()
        .from(metricPoints)
        .where(eq(metricPoints.metricId, row.metricId!));
      expect(points.map((p) => p.value)).toEqual([42]);
      const [metric] = await db.select().from(metrics).where(eq(metrics.id, row.metricId!));
      expect(metric).toMatchObject({
        key: 'stars',
        subjectId: widget.id,
        subjectType: 'widget',
      });

      // Invalid output then a timeout: failures accumulate, last good output stays.
      runSandbox.mockResolvedValueOnce({ ...ok({}), stdout: 'not json' });
      const invalid = (await owner.run({ widgetId: widget.id }))!.data;
      expect(invalid).toMatchObject({ error: { code: 'INVALID_JSON' }, status: 'failed' });
      runSandbox.mockResolvedValueOnce({ ...ok({}), exitCode: 124, stdout: '', timedOut: true });
      const timeout = (await owner.run({ widgetId: widget.id }))!.data;
      expect(timeout).toMatchObject({ error: { code: 'TIMEOUT' }, status: 'timeout' });

      [row] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
      expect(row).toMatchObject({
        consecutiveFailures: 2,
        lastRunError: { code: 'TIMEOUT' },
        lastRunStatus: 'timeout',
        latestOutput: { type: 'stat', value: 42 },
      });

      // A partial result finishes as `partial`: it renders, but is not a trend sample.
      runSandbox.mockResolvedValueOnce(
        ok({ meta: { complete: false, message: 'one repo failed' }, type: 'stat', value: 40 }),
      );
      const partial = (await owner.run({ widgetId: widget.id }))!.data;
      expect(partial).toMatchObject({
        error: null,
        output: { meta: { complete: false, message: 'one repo failed' }, value: 40 },
        status: 'partial',
      });
      [row] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
      expect(row).toMatchObject({
        consecutiveFailures: 0,
        lastRunError: null,
        lastRunStatus: 'partial',
        latestOutput: { value: 40 },
      });
      const pointsAfter = await db
        .select()
        .from(metricPoints)
        .where(eq(metricPoints.metricId, row.metricId!));
      expect(pointsAfter).toHaveLength(1);

      const runs = (await owner.listRuns({ widgetId: widget.id }))!.data;
      expect(runs.map((r) => r.status)).toEqual([
        'partial',
        'timeout',
        'failed',
        'succeeded',
        'succeeded',
      ]);
    });

    it('records no metric and keeps the trend link for a stale run that finishes late', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await publishStat(owner);
      const widgetRow = async () =>
        (await db.select().from(widgets).where(eq(widgets.id, widget.id)))[0];
      const versionRow = async (id: string) =>
        (await db.select().from(widgetVersions).where(eq(widgetVersions.id, id)))[0];
      const allPoints = async () =>
        (
          await db
            .select({ value: metricPoints.value })
            .from(metricPoints)
            .innerJoin(metrics, eq(metricPoints.metricId, metrics.id))
            .where(eq(metrics.subjectId, widget.id))
        )
          .map((p) => p.value)
          .sort((a, b) => a - b);

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 42 }));
      await owner.run({ widgetId: widget.id });
      const v1Row = await widgetRow();
      const v1 = await versionRow(v1Row.publishedVersionId!);

      // a v1 run is in flight when v2 (a different metric key) goes live
      const oldVersionRun = await WidgetModel.startRun(db, v1Row, { trigger: 'schedule' });
      const v2 = (await owner.saveDraft({
        manifest: { metric: { key: 'forks' } },
        widgetId: widget.id,
        ...statScript,
        script: 'console.log(2)',
      }))!.data;
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: v2.id, widgetId: widget.id });

      // a v2 run starts, then a newer one finishes first and owns the snapshot
      const startedEarly = await WidgetModel.startRun(db, await widgetRow(), {
        trigger: 'schedule',
      });
      await db
        .update(widgetRuns)
        .set({ startedAt: new Date(Date.now() - 60_000) })
        .where(eq(widgetRuns.id, startedEarly.id));
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 10 }));
      await owner.run({ widgetId: widget.id });
      const current = await widgetRow();
      const forksMetricId = current.metricId;
      expect(forksMetricId).not.toBe(v1Row.metricId);
      expect(await allPoints()).toEqual([10, 42]);

      const runner = { run: runSandbox };
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 99 }));
      const lateOld = await executeWidgetRun(
        db,
        { run: oldVersionRun, version: v1, widget: current },
        { runner },
      );
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 98 }));
      const lateEarly = await executeWidgetRun(
        db,
        { run: startedEarly, version: await versionRow(v2.id), widget: current },
        { runner },
      );

      // both runs are closed, but neither enters the trend nor moves the link
      expect(lateOld).toMatchObject({ id: oldVersionRun.id, status: 'succeeded' });
      expect(lateEarly).toMatchObject({ id: startedEarly.id, status: 'succeeded' });
      expect(await allPoints()).toEqual([10, 42]);
      expect(await widgetRow()).toMatchObject({
        latestOutput: { type: 'stat', value: 10 },
        metricId: forksMetricId,
      });
    });

    it('labels a manual run with the version it executes when a publish races it', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await publishStat(owner);
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 42 }));
      await owner.run({ widgetId: widget.id });
      const v1Id = (await db.select().from(widgets).where(eq(widgets.id, widget.id)))[0]
        .publishedVersionId!;

      const v2 = (await owner.saveDraft({
        widgetId: widget.id,
        ...statScript,
        script: 'console.log(2)',
      }))!.data;
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: widget.id });

      // v2 goes live between runNow reading v1 and the run row being created
      const startRun = WidgetModel.prototype.startRun;
      vi.spyOn(WidgetModel.prototype, 'startRun').mockImplementationOnce(async function (
        this: WidgetModel,
        ...args: Parameters<WidgetModel['startRun']>
      ) {
        await new WidgetModel(db, ownerId).publishVersion(widget.id, v2.id);
        return startRun.apply(this, args);
      });
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 99 }));
      await owner.run({ widgetId: widget.id });

      // the run executed v1's script, so it is labeled v1 and does not become v2's result
      const [latestRun] = await db
        .select()
        .from(widgetRuns)
        .where(and(eq(widgetRuns.widgetId, widget.id), eq(widgetRuns.trigger, 'manual')))
        .orderBy(desc(widgetRuns.startedAt))
        .limit(1);
      expect(latestRun.versionId).toBe(v1Id);
      expect((await db.select().from(widgets).where(eq(widgets.id, widget.id)))[0]).toMatchObject({
        latestOutput: { type: 'stat', value: 42 },
        publishedVersionId: v2.id,
      });
    });

    it('passes the manifest network allowlist to the sandbox', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner);
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 1 }));

      await owner.saveDraft({
        manifest: { network: { allow: ['api.github.com', 'gitlab.com'] } },
        widgetId: widget.id,
        ...statScript,
      });
      await owner.dryRun({ widgetId: widget.id });
      await owner.saveDraft({ widgetId: widget.id, ...statScript, script: 'console.log(2)' });
      await owner.dryRun({ widgetId: widget.id });

      expect(runSandbox.mock.calls.map(([request]) => request.network)).toEqual([
        { allow: ['api.github.com', 'gitlab.com'] },
        { allow: [] },
      ]);
      expect(runSandbox.mock.calls[0][0].subject).toEqual({ id: widget.id, kind: 'widget' });
    });

    it('appends only new series points to per-series metrics', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner, { title: 'Deploys' });
      const draft = (await owner.saveDraft({
        outputType: 'series',
        runtime: 'python',
        script: 'print(1)',
        widgetId: widget.id,
      }))!.data;
      const series = (points: [string, number][]) =>
        ok({
          series: [{ name: 'deploys', points: points.map(([t, v]) => ({ t, v })) }],
          type: 'series',
        });
      runSandbox.mockResolvedValueOnce(series([['2026-09-01', 1]]));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });

      runSandbox.mockResolvedValueOnce(
        series([
          ['2026-09-01', 1],
          ['2026-09-02', 3],
        ]),
      );
      await owner.run({ widgetId: widget.id });
      runSandbox.mockResolvedValueOnce(
        series([
          ['2026-09-02', 3],
          ['2026-09-03', 2],
        ]),
      );
      await owner.run({ widgetId: widget.id });

      const [metric] = await db
        .select()
        .from(metrics)
        .where(and(eq(metrics.subjectId, widget.id), eq(metrics.key, 'series:deploys')));
      const points = await db
        .select()
        .from(metricPoints)
        .where(eq(metricPoints.metricId, metric.id))
        .orderBy(metricPoints.observedAt);
      expect(points.map((p) => [p.observedAt.toISOString().slice(0, 10), p.value])).toEqual([
        ['2026-09-01', 1],
        ['2026-09-02', 3],
        ['2026-09-03', 2],
      ]);
    });
    it('writes an overlapping series batch once when two runs record it concurrently', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner, { title: 'Deploys' });
      const output = {
        series: [
          {
            name: 'deploys',
            points: [
              { t: '2026-09-01', v: 1 },
              { t: '2026-09-02', v: 3 },
            ],
          },
        ],
        type: 'series' as const,
      };
      const record = (runId: string) =>
        recordWidgetMetrics(db, widget, { observedAt: new Date(), output, runId });

      // a manual refresh and a scheduled run report the same window at once
      const results = await Promise.all([record('run-a'), record('run-b')]);
      expect(results.map((r) => r.pointsWritten).sort()).toEqual([0, 2]);

      const [metric] = await db
        .select()
        .from(metrics)
        .where(and(eq(metrics.subjectId, widget.id), eq(metrics.key, 'series:deploys')));
      const points = await db
        .select()
        .from(metricPoints)
        .where(eq(metricPoints.metricId, metric.id))
        .orderBy(metricPoints.observedAt);
      expect(points.map((p) => [p.observedAt.toISOString().slice(0, 10), p.value])).toEqual([
        ['2026-09-01', 1],
        ['2026-09-02', 3],
      ]);
    });
  });

  describe('credentials', () => {
    const gateKeeperModel = async (userId: string, ws?: string) =>
      new ConnectorModel(db, userId, ws, await KeyVaultsGateKeeper.initWithEnvKey());

    const githubConnector = (token: string, extra: Record<string, unknown> = {}) => ({
      credentials: JSON.stringify({ token, type: 'bearer' }),
      identifier: 'github',
      name: 'GitHub',
      sourceType: 'custom',
      status: 'connected',
      ...extra,
    });

    const draftWithEnv = async (caller: WidgetCaller, widgetId: string) =>
      (await caller.saveDraft({
        manifest: { env: [{ connector: 'github', name: 'GITHUB_TOKEN' }] },
        widgetId,
        ...statScript,
      }))!.data;

    it('never falls back to the creator personal connector for a workspace widget', async () => {
      await (await gateKeeperModel(ownerId)).create(githubConnector('personal-token-123') as any);
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));
      const widget = await createWidget(owner);
      await draftWithEnv(owner, widget.id);

      const run = (await owner.dryRun({ widgetId: widget.id }))!.data;
      expect(run).toMatchObject({
        error: {
          code: 'MISSING_ENV',
          message:
            'Missing required environment: GITHUB_TOKEN (connect "github" for this widget\'s agent or workspace)',
        },
        status: 'failed',
      });
      expect(runSandbox).not.toHaveBeenCalled();
    });

    it('resolves a project widget with the workspace credential, never the personal one', async () => {
      const coordinatorId = await createTestAgent(db, ownerId);
      await db.update(agents).set({ workspaceId }).where(eq(agents.id, coordinatorId));
      const [project] = await db
        .insert(projects)
        .values({
          coordinatorAgentId: coordinatorId,
          identifier: 'DASH',
          name: 'Dashboards project',
          userId: ownerId,
          workspaceId,
        })
        .returning();
      await (await gateKeeperModel(ownerId)).create(githubConnector('personal-token-123') as any);
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));
      const widget = await createWidget(owner, { projectId: project.id, title: 'Project PRs' });
      expect(widget).toMatchObject({ agentId: null, projectId: project.id, workspaceId });
      await draftWithEnv(owner, widget.id);

      // Only the creator's personal connector exists: the project widget must not use it.
      const missing = (await owner.dryRun({ widgetId: widget.id }))!.data;
      expect(missing).toMatchObject({ error: { code: 'MISSING_ENV' }, status: 'failed' });
      expect(runSandbox).not.toHaveBeenCalled();

      await (
        await gateKeeperModel(ownerId, workspaceId)
      ).create(githubConnector('workspace-token-456') as any);
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      const run = (await owner.dryRun({ widgetId: widget.id }))!.data;

      expect(run?.status).toBe('succeeded');
      expect(runSandbox.mock.calls[0][0].env).toEqual({ GITHUB_TOKEN: 'workspace-token-456' });
    });

    it('injects a workspace connector only into widgets its creator or the workspace owner authored', async () => {
      // The owner's GitHub connector and a member's Linear connector, both workspace-wide.
      await (
        await gateKeeperModel(ownerId, workspaceId)
      ).create(githubConnector('owner-token-456') as any);
      await (
        await gateKeeperModel(memberId, workspaceId)
      ).create(
        githubConnector('member-token-789', { identifier: 'linear', name: 'Linear' }) as any,
      );
      const member = widgetRouter.createCaller(context(memberId, workspaceId));
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));
      const linearDraft = (caller: WidgetCaller, widgetId: string) =>
        caller.saveDraft({
          manifest: { env: [{ connector: 'linear', name: 'LINEAR_TOKEN' }] },
          widgetId,
          ...statScript,
        });

      // A member's script must not receive a secret someone else connected.
      const sneaky = await createWidget(member, { title: 'Sneaky' });
      await draftWithEnv(member, sneaky.id);
      const refused = (await member.dryRun({ widgetId: sneaky.id }))!.data;
      expect(refused).toMatchObject({
        error: {
          code: 'CREDENTIALS_FORBIDDEN',
          message:
            'Connector "github" was connected by another workspace member; only its creator or the workspace owner can author a widget that reads it',
        },
        status: 'failed',
      });
      expect(runSandbox).not.toHaveBeenCalled();

      // Their own workspace connector is fine.
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 1 }));
      const own = await createWidget(member, { title: 'Own' });
      await linearDraft(member, own.id);
      expect((await member.dryRun({ widgetId: own.id }))!.data?.status).toBe('succeeded');
      expect(runSandbox.mock.calls[0][0].env).toEqual({ LINEAR_TOKEN: 'member-token-789' });

      // The workspace owner may use any workspace connector.
      const curated = await createWidget(owner, { title: 'Curated' });
      await linearDraft(owner, curated.id);
      expect((await owner.dryRun({ widgetId: curated.id }))!.data?.status).toBe('succeeded');
      expect(runSandbox.mock.calls[1][0].env).toEqual({ LINEAR_TOKEN: 'member-token-789' });
    });

    it('reads the header a manifest names from a multi-header connector', async () => {
      await (
        await gateKeeperModel(ownerId, workspaceId)
      ).create({
        ...githubConnector(''),
        credentials: JSON.stringify({
          headers: { 'X-Api-Key': 'key-1', 'X-Tenant': 'tenant-1' },
          type: 'header',
        }),
      } as any);
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));
      const widget = await createWidget(owner);
      const draft = (await owner.saveDraft({
        manifest: { env: [{ connector: 'github', field: 'X-Tenant', name: 'TENANT' }] },
        widgetId: widget.id,
        ...statScript,
      }))!.data;
      expect(draft.manifest?.env).toEqual([
        { connector: 'github', field: 'X-Tenant', name: 'TENANT' },
      ]);

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      expect((await owner.dryRun({ widgetId: widget.id }))!.data?.status).toBe('succeeded');
      expect(runSandbox.mock.calls[0][0].env).toEqual({ TENANT: 'tenant-1' });
    });

    it('closes the run as failed when credential resolution itself errors', async () => {
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));
      const widget = await createWidget(owner);
      await draftWithEnv(owner, widget.id);
      const initWithEnvKey = vi
        .spyOn(KeyVaultsGateKeeper, 'initWithEnvKey')
        .mockRejectedValueOnce(new Error('KEY_VAULTS_SECRET is not set'));

      const run = (await owner.dryRun({ widgetId: widget.id }))!.data;

      expect(run).toMatchObject({
        error: { code: 'CREDENTIALS_ERROR', message: 'Failed to resolve widget credentials' },
        status: 'failed',
      });
      expect(runSandbox).not.toHaveBeenCalled();
      initWithEnvKey.mockRestore();
    });

    it('injects the workspace credential, prefers the agent one, and redacts echoes', async () => {
      await (await gateKeeperModel(ownerId)).create(githubConnector('personal-token-123') as any);
      await (
        await gateKeeperModel(ownerId, workspaceId)
      ).create(githubConnector('workspace-token-456') as any);
      const owner = widgetRouter.createCaller(context(ownerId, workspaceId));

      const widget = await createWidget(owner);
      await draftWithEnv(owner, widget.id);
      runSandbox.mockImplementationOnce(async ({ env }) => ({
        ...ok({ label: `token ${env.GITHUB_TOKEN}`, type: 'stat', value: 1 }),
        stderr: `debug: using ${env.GITHUB_TOKEN}`,
      }));
      const run = (await owner.dryRun({ widgetId: widget.id }))!.data;

      expect(runSandbox.mock.calls[0][0].env).toEqual({ GITHUB_TOKEN: 'workspace-token-456' });
      expect(run?.status).toBe('succeeded');
      expect(run?.output).toMatchObject({ label: 'token [REDACTED:GITHUB_TOKEN]' });
      expect(run?.stdout).not.toContain('workspace-token-456');
      expect(run?.stderr).toBe('debug: using [REDACTED:GITHUB_TOKEN]');

      // An agent-scoped connector outranks the workspace one for the agent's widget.
      const agentId = await createTestAgent(db, ownerId);
      await db.update(agents).set({ workspaceId }).where(eq(agents.id, agentId));
      await (
        await gateKeeperModel(ownerId, workspaceId)
      ).create(githubConnector('agent-token-789', { agentId }) as any);
      const agentWidget = await createWidget(owner, { agentId, title: 'Agent PRs' });
      await draftWithEnv(owner, agentWidget.id);
      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: agentWidget.id });

      expect(runSandbox.mock.calls[1][0].env).toEqual({ GITHUB_TOKEN: 'agent-token-789' });
    });
  });

  describe('runAgentTool', () => {
    it('scopes widgets to the conversation’s agent and project, ignoring foreign topics', async () => {
      const agentId = await createTestAgent(db, ownerId);
      const coordinatorId = await createTestAgent(db, ownerId);
      const [project] = await db
        .insert(projects)
        .values({
          coordinatorAgentId: coordinatorId,
          identifier: 'TOOL',
          name: 'P',
          userId: ownerId,
        })
        .returning();
      await db.insert(topics).values([
        { agentId, id: `tpc_own_${ownerId}`, projectId: project.id, userId: ownerId },
        { id: `tpc_other_${memberId}`, projectId: project.id, userId: memberId },
      ]);
      const { board } = callers(ownerId);
      const createArgs = { ...statScript, description: 'Always 7', title: 'Seven' };

      const created = await board.runAgentTool({
        apiName: 'createWidgetDraft',
        args: createArgs,
        context: { agentId, operationId: 'op_1', topicId: `tpc_own_${ownerId}` },
      });
      expect(created).toMatchObject({ success: true });
      const [widget] = await db
        .select()
        .from(widgets)
        .where(eq(widgets.id, created.state.widgetId));
      expect(widget).toMatchObject({ agentId, projectId: project.id, userId: ownerId });

      // Another user's topic id is dropped instead of leaking its project.
      const foreign = await board.runAgentTool({
        apiName: 'createWidgetDraft',
        args: createArgs,
        context: { agentId, topicId: `tpc_other_${memberId}` },
      });
      const [foreignWidget] = await db
        .select()
        .from(widgets)
        .where(eq(widgets.id, foreign.state.widgetId));
      expect(foreignWidget).toMatchObject({ agentId, projectId: null });

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 7 }));
      const dryRun = await board.runAgentTool({
        apiName: 'dryRunWidget',
        args: { widgetId: widget.id },
        context: { operationId: 'op_1' },
      });
      expect(dryRun).toMatchObject({ state: { status: 'succeeded' }, success: true });
      expect(dryRun.content).toContain('"value": 7');
    });

    it('rejects unknown tool APIs', async () => {
      const { board } = callers(ownerId);
      await expect(
        board.runAgentTool({ apiName: 'publish', args: {} } as any),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('permissions', () => {
    it('lets members read and refresh public widgets but not author them', async () => {
      const { board: ownerBoard, widget: owner } = callers(ownerId, workspaceId);
      const { board: memberBoard, widget: member } = callers(memberId, workspaceId);
      const outsider = widgetRouter.createCaller(context(outsiderId));

      const board = (await ownerBoard.create({ title: 'Team board' }))!.data;
      const widget = await createWidget(owner, { dashboardId: board.id, title: 'CI health' });
      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });

      const detail = (await memberBoard.detail({ id: board.id }))!.data;
      expect(detail.items.map((i) => i.widget.id)).toEqual([widget.id]);
      expect((await member.run({ widgetId: widget.id }))!.data?.status).toBe('succeeded');

      await expect(
        member.saveDraft({ widgetId: widget.id, ...statScript, script: 'x' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        member.publish({ versionId: draft.id, widgetId: widget.id }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        memberBoard.update({ id: board.id, value: { title: 'x' } }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      await expect(outsider.detail({ id: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.run({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.listVersions({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.listRuns({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const secret = await createWidget(owner, { title: 'Mine', visibility: 'private' });
      await expect(member.detail({ id: secret.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect((await member.list())!.data.map((w) => w.id)).toEqual([widget.id]);
    });

    it('hides a public widget, its versions, runs and metric series once its project turns private', async () => {
      const coordinatorId = await createTestAgent(db, ownerId);
      await db.update(agents).set({ workspaceId }).where(eq(agents.id, coordinatorId));
      const [project] = await db
        .insert(projects)
        .values({
          coordinatorAgentId: coordinatorId,
          identifier: 'FLIP',
          name: 'Flipping project',
          userId: ownerId,
          workspaceId,
        })
        .returning();
      const { board: ownerBoard, widget: owner } = callers(ownerId, workspaceId);
      const { board: memberBoard, widget: member } = callers(memberId, workspaceId);
      const memberMetrics = metricRouter.createCaller(context(memberId, workspaceId));

      const board = (await ownerBoard.create({ title: 'Team board' }))!.data;
      const widget = await createWidget(owner, {
        dashboardId: board.id,
        projectId: project.id,
        title: 'Project stars',
      });
      const draft = (await owner.saveDraft({
        manifest: { metric: { key: 'stars' } },
        widgetId: widget.id,
        ...statScript,
      }))!.data;
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 3 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });
      const run = (await owner.run({ widgetId: widget.id }))!.data!;
      const series = { subjectId: widget.id, subjectType: 'widget' as const };
      expect((await memberMetrics.listSeries(series))!.data).toHaveLength(1);

      await db.update(projects).set({ visibility: 'private' }).where(eq(projects.id, project.id));

      const notFound = { code: 'NOT_FOUND' };
      await expect(member.detail({ id: widget.id })).rejects.toMatchObject(notFound);
      await expect(member.listVersions({ widgetId: widget.id })).rejects.toMatchObject(notFound);
      await expect(
        member.getVersion({ versionId: draft.id, widgetId: widget.id }),
      ).rejects.toMatchObject(notFound);
      await expect(member.listRuns({ widgetId: widget.id })).rejects.toMatchObject(notFound);
      await expect(member.getRun({ runId: run.id, widgetId: widget.id })).rejects.toMatchObject(
        notFound,
      );
      await expect(member.run({ widgetId: widget.id })).rejects.toMatchObject(notFound);
      await expect(memberMetrics.listSeries(series)).rejects.toMatchObject(notFound);
      expect((await member.listByProject({ projectId: project.id }))!.data).toEqual([]);
      // the public board stays, without the hidden widget
      expect((await memberBoard.detail({ id: board.id }))!.data.items).toEqual([]);

      // the project's creator still reads everything
      expect((await owner.detail({ id: widget.id }))!.data.id).toBe(widget.id);
    });

    it('refuses to create a widget on a board the caller cannot manage, leaving no orphan', async () => {
      const ownerBoard = dashboardRouter.createCaller(context(ownerId, workspaceId));
      const member = widgetRouter.createCaller(context(memberId, workspaceId));
      const board = (await ownerBoard.create({ title: 'Team board' }))!.data;

      await expect(
        createWidget(member, { dashboardId: board.id, title: 'Sneaky' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await db.select().from(widgets).where(eq(widgets.workspaceId, workspaceId))).toEqual(
        [],
      );
    });

    it('fails and keeps no widget when the board cannot take it after the check', async () => {
      const { board: ownerBoard, widget: owner } = callers(ownerId, workspaceId);
      const board = (await ownerBoard.create({ title: 'Team board' }))!.data;
      const workspaceWidgets = () =>
        db.select().from(widgets).where(eq(widgets.workspaceId, workspaceId));

      // The board is gone by the time the widget is placed.
      vi.spyOn(DashboardModel.prototype, 'addItem').mockResolvedValueOnce(undefined);
      await expect(
        createWidget(owner, { dashboardId: board.id, title: 'Vanished board' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await workspaceWidgets()).toEqual([]);

      // The placement insert itself fails.
      vi.spyOn(DashboardModel.prototype, 'addItem').mockRejectedValueOnce(
        new Error('FK violation'),
      );
      await expect(
        createWidget(owner, { dashboardId: board.id, title: 'Failed placement' }),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      expect(await workspaceWidgets()).toEqual([]);

      const placed = await createWidget(owner, { dashboardId: board.id, title: 'Placed' });
      expect(placed.item).toMatchObject({ dashboardId: board.id, widgetId: placed.id });
    });

    it('rejects malformed ids before they reach the database', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));

      await expect(owner.detail({ id: 'not-a-uuid' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('schedule', () => {
    it('validates cron patterns and fires due widgets once per slot from the tick route', async () => {
      const owner = widgetRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner);

      await expect(owner.setSchedule({ id: widget.id, pattern: '* * *' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      const scheduled = (await owner.setSchedule({
        id: widget.id,
        pattern: '*/5 * * * *',
        timezone: 'Asia/Shanghai',
      }))!.data;
      expect(scheduled.nextRunAt).toBeInstanceOf(Date);

      // Not published yet: nothing is due.
      await db
        .update(widgets)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(widgets.id, widget.id));
      expect(await runWidgetSchedulerTick(db, { runner: { run: runSandbox } })).toMatchObject({
        due: 0,
      });

      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 5 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });
      await db
        .update(widgets)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(widgets.id, widget.id));

      const response = await widgetWorkflowApp.request('/tick', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const body = await response.json();
      expect(body).toMatchObject({
        claimed: 1,
        dispatched: 1,
        due: 1,
        results: [{ status: 'succeeded', widgetId: widget.id }],
        success: true,
      });

      const [row] = await db.select().from(widgets).where(eq(widgets.id, widget.id));
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(row.latestOutput).toEqual({ type: 'stat', value: 5 });
      const runs = await db
        .select()
        .from(widgetRuns)
        .where(and(eq(widgetRuns.widgetId, widget.id), eq(widgetRuns.trigger, 'schedule')));
      expect(runs).toHaveLength(1);

      // The slot moved forward, so an immediate second tick has nothing to do.
      const second = await widgetWorkflowApp.request('/tick', { body: '{}', method: 'POST' });
      expect(await second.json()).toMatchObject({ claimed: 0, due: 0 });
    });

    describe('dispatch and recovery', () => {
      const post = async (path: string, body: unknown) =>
        (
          await widgetWorkflowApp.request(path, {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          })
        ).json();

      /** A published, scheduled widget whose slot is due. */
      const dueWidget = async () => {
        const owner = widgetRouter.createCaller(context(ownerId));
        const widget = await createWidget(owner);
        await owner.setSchedule({ id: widget.id, pattern: '*/5 * * * *' });
        const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
        runSandbox.mockResolvedValue(ok({ type: 'stat', value: 5 }));
        await owner.dryRun({ widgetId: widget.id });
        await owner.publish({ versionId: draft.id, widgetId: widget.id });
        runSandbox.mockClear();
        const slot = new Date(Date.now() - 60_000);
        await db.update(widgets).set({ nextRunAt: slot }).where(eq(widgets.id, widget.id));
        return { slot, widget };
      };

      const scheduleRuns = (widgetId: string) =>
        db
          .select()
          .from(widgetRuns)
          .where(and(eq(widgetRuns.widgetId, widgetId), eq(widgetRuns.trigger, 'schedule')));

      const nextRunAt = async (widgetId: string) =>
        (await db.select().from(widgets).where(eq(widgets.id, widgetId)))[0].nextRunAt;

      it('publishes each due slot with a per-slot dedup id and leaves the claim to the worker', async () => {
        vi.stubEnv('APP_URL', 'https://app.test/');
        queueMode.enabled = true;
        const publish = vi
          .spyOn(qstashClient, 'publishJSON')
          .mockResolvedValue({ messageId: 'm1' } as never);
        const { slot, widget } = await dueWidget();

        expect(await post('/tick', {})).toMatchObject({ claimed: 0, dispatched: 1, due: 1 });
        expect(publish).toHaveBeenCalledWith({
          body: { slot: slot.toISOString(), widgetId: widget.id },
          deduplicationId: `widget:${widget.id}:${slot.toISOString()}`,
          url: 'https://app.test/api/workflows/widget/run-widget',
        });
        // Not claimed and nothing ran in the tick: the slot is still due.
        expect(await nextRunAt(widget.id)).toEqual(slot);
        expect(runSandbox).not.toHaveBeenCalled();

        // A failed publish keeps the slot due, so the next tick retries it.
        publish.mockRejectedValueOnce(new Error('qstash down'));
        expect(await post('/tick', {})).toMatchObject({
          dispatched: 0,
          results: [{ error: expect.stringContaining('qstash down'), widgetId: widget.id }],
        });
        expect(await nextRunAt(widget.id)).toEqual(slot);
      });

      it('runs a redelivered slot exactly once', async () => {
        const { slot, widget } = await dueWidget();
        const message = { slot: slot.toISOString(), widgetId: widget.id };

        expect(await post('/run-widget', message)).toMatchObject({
          status: 'succeeded',
          success: true,
        });
        // QStash redelivers the same message after a lost response.
        expect(await post('/run-widget', message)).toEqual({
          skipped: 'already-claimed',
          success: true,
        });

        expect(runSandbox).toHaveBeenCalledTimes(1);
        expect(await scheduleRuns(widget.id)).toHaveLength(1);
        expect((await nextRunAt(widget.id))!.getTime()).toBeGreaterThan(Date.now());
      });

      /** Make a reserved run look abandoned: started well past any lease. */
      const expireLease = (runId: string) =>
        db
          .update(widgetRuns)
          .set({ startedAt: new Date(Date.now() - 30 * 60_000) })
          .where(eq(widgetRuns.id, runId));

      /** Deliver the slot to a worker that dies after reserving the run. */
      const crashAfterReserve = async (message: { slot: string; widgetId: string }) => {
        vi.spyOn(WidgetModel, 'finishRun').mockRejectedValueOnce(new Error('worker killed'));
        expect(await post('/run-widget', message)).toEqual({ error: 'worker killed' });
        const runs = await scheduleRuns(message.widgetId);
        expect(runs).toMatchObject([{ status: 'running' }]);
        return runs[0];
      };

      it('resumes a reserved run once its worker died and the lease expired, exactly once', async () => {
        const { slot, widget } = await dueWidget();
        const message = { slot: slot.toISOString(), widgetId: widget.id };
        const reserved = await crashAfterReserve(message);

        // Redelivered while the original worker may still be busy: left alone.
        expect(await post('/run-widget', message)).toEqual({
          skipped: 'already-claimed',
          success: true,
        });
        expect(runSandbox).toHaveBeenCalledTimes(1);

        await expireLease(reserved.id);
        const [resumed, again] = await Promise.all([
          post('/run-widget', message),
          post('/run-widget', message),
        ]);
        expect([resumed, again]).toEqual(
          expect.arrayContaining([
            { resumed: true, runId: reserved.id, status: 'succeeded', success: true },
            { skipped: 'already-claimed', success: true },
          ]),
        );
        expect(await post('/run-widget', message)).toEqual({
          skipped: 'already-claimed',
          success: true,
        });

        expect(runSandbox).toHaveBeenCalledTimes(2);
        expect(await scheduleRuns(widget.id)).toMatchObject([
          { id: reserved.id, status: 'succeeded' },
        ]);
        expect((await db.select().from(widgets).where(eq(widgets.id, widget.id)))[0]).toMatchObject(
          { lastRunId: reserved.id, latestOutput: { type: 'stat', value: 5 } },
        );
      });

      it('sweeps a stale reservation from the tick and resumes it through the worker', async () => {
        vi.stubEnv('APP_URL', 'https://app.test/');
        const { slot, widget } = await dueWidget();
        const reserved = await crashAfterReserve({ slot: slot.toISOString(), widgetId: widget.id });

        queueMode.enabled = true;
        const publish = vi
          .spyOn(qstashClient, 'publishJSON')
          .mockResolvedValue({ messageId: 'm1' } as never);

        // Still within its lease: the tick does not touch it.
        expect(await post('/tick', {})).toMatchObject({ due: 0, resumed: 0 });
        expect(publish).not.toHaveBeenCalled();

        await expireLease(reserved.id);
        const [{ startedAt }] = await scheduleRuns(widget.id);
        const leaseStartedAt = startedAt.toISOString();
        expect(await post('/tick', {})).toMatchObject({ due: 0, resumed: 1 });
        const resumeMessage = { leaseStartedAt, runId: reserved.id, widgetId: widget.id };
        expect(publish).toHaveBeenCalledWith({
          body: resumeMessage,
          deduplicationId: `widget-run:${reserved.id}:${leaseStartedAt}`,
          url: 'https://app.test/api/workflows/widget/run-widget',
        });

        expect(await post('/run-widget', resumeMessage)).toEqual({
          resumed: true,
          runId: reserved.id,
          status: 'succeeded',
          success: true,
        });
        // A duplicate resume message finds the lease renewed and the run closed.
        expect(await post('/run-widget', resumeMessage)).toEqual({
          skipped: 'not-resumable',
          success: true,
        });
        expect(runSandbox).toHaveBeenCalledTimes(2);
        expect(await scheduleRuns(widget.id)).toMatchObject([{ status: 'succeeded' }]);
      });

      it('resumes a stale reservation inline when the tick runs widgets itself', async () => {
        const { widget } = await dueWidget();

        // The inline tick reserves the slot and dies before closing the run.
        vi.spyOn(WidgetModel, 'finishRun').mockRejectedValueOnce(new Error('worker killed'));
        expect(await post('/tick', {})).toMatchObject({
          claimed: 1,
          results: [{ error: 'worker killed', widgetId: widget.id }],
        });
        const [reserved] = await scheduleRuns(widget.id);
        expect(reserved).toMatchObject({ status: 'running' });

        expect(await post('/tick', {})).toMatchObject({ claimed: 0, due: 0, resumed: 0 });
        await expireLease(reserved.id);
        expect(await post('/tick', {})).toMatchObject({
          claimed: 0,
          due: 0,
          resumed: 1,
          results: [{ runId: reserved.id, status: 'succeeded', widgetId: widget.id }],
        });
        expect(await post('/tick', {})).toMatchObject({ resumed: 0 });

        expect(runSandbox).toHaveBeenCalledTimes(2);
        expect(await scheduleRuns(widget.id)).toMatchObject([
          { id: reserved.id, status: 'succeeded' },
        ]);
      });

      it('cancels a dead reservation when the schedule is cleared, so re-enabling never resumes it', async () => {
        const owner = widgetRouter.createCaller(context(ownerId));
        const { widget } = await dueWidget();

        vi.spyOn(WidgetModel, 'finishRun').mockRejectedValueOnce(new Error('worker killed'));
        await post('/tick', {});
        const [reserved] = await scheduleRuns(widget.id);
        expect(reserved).toMatchObject({ status: 'running' });

        await owner.setSchedule({ id: widget.id, pattern: null });
        await owner.setSchedule({ id: widget.id, pattern: '*/5 * * * *' });
        await expireLease(reserved.id);

        expect(await post('/tick', {})).toMatchObject({ resumed: 0 });
        expect(runSandbox).toHaveBeenCalledTimes(1);
        expect(await scheduleRuns(widget.id)).toMatchObject([
          { error: { code: 'SCHEDULE_CHANGED' }, id: reserved.id, status: 'failed' },
        ]);
      });

      it('loses the claim when the widget is trashed or republished after the due read', async () => {
        const owner = widgetRouter.createCaller(context(ownerId));
        const { slot, widget } = await dueWidget();
        const [due] = await WidgetModel.findDue(db, { now: new Date() });
        expect(due.widget.id).toBe(widget.id);
        const claim = () =>
          WidgetModel.claimDueRun(db, {
            expectedNextRunAt: slot,
            nextRunAt: new Date(Date.now() + 300_000),
            versionId: due.version.id,
            widgetId: widget.id,
          });

        // a republish between the due read and the claim
        const v2 = (await owner.saveDraft({ widgetId: widget.id, ...statScript, script: 'x' }))!
          .data;
        runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 2 }));
        await owner.dryRun({ widgetId: widget.id });
        await owner.publish({ versionId: v2.id, widgetId: widget.id });
        await db.update(widgets).set({ nextRunAt: slot }).where(eq(widgets.id, widget.id));
        expect(await claim()).toBeUndefined();

        // a trash between the due read and the claim
        await new WidgetModel(db, ownerId).trash(widget.id);
        expect(
          await WidgetModel.claimDueRun(db, {
            expectedNextRunAt: slot,
            nextRunAt: new Date(Date.now() + 300_000),
            versionId: v2.id,
            widgetId: widget.id,
          }),
        ).toBeUndefined();
        expect(await scheduleRuns(widget.id)).toEqual([]);
        expect(await nextRunAt(widget.id)).toEqual(slot);
      });

      it('never leaves an old-schedule reservation behind when a claim races a schedule change', async () => {
        const owner = widgetRouter.createCaller(context(ownerId));
        for (let i = 0; i < 5; i++) {
          const { slot, widget } = await dueWidget();
          const [due] = await WidgetModel.findDue(db, { now: new Date() });
          await Promise.all([
            WidgetModel.claimDueRun(db, {
              expectedNextRunAt: slot,
              nextRunAt: new Date(Date.now() + 300_000),
              versionId: due.version.id,
              widgetId: widget.id,
            }),
            owner.setSchedule({ id: widget.id, pattern: null }),
          ]);
          const running = (await scheduleRuns(widget.id)).filter((r) => r.status === 'running');
          expect(running).toEqual([]);
          expect(await nextRunAt(widget.id)).toBeNull();
        }
      });

      it('acks a message without a slot without running or claiming', async () => {
        const { slot, widget } = await dueWidget();

        expect(await post('/run-widget', { widgetId: widget.id })).toEqual({
          skipped: 'missing-slot',
          success: true,
        });
        expect(runSandbox).not.toHaveBeenCalled();
        expect(await scheduleRuns(widget.id)).toHaveLength(0);
        expect(await nextRunAt(widget.id)).toEqual(slot);
      });
    });
  });
});
