// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  dashboardWidgetRuns,
  dashboardWidgets,
  metricPoints,
  metrics,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import dashboardWorkflowApp from '@/server/router-hono/workflows/dashboard';
import { DashboardSandboxRunner } from '@/server/services/dashboard/sandboxRunner';
import { runDashboardSchedulerTick } from '@/server/services/dashboard/scheduler';

import { dashboardRouter } from '../../dashboard';
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

const runSandbox = vi.fn();
vi.spyOn(DashboardSandboxRunner, 'fromEnv').mockReturnValue({
  run: runSandbox,
} as unknown as DashboardSandboxRunner);

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

describe('dashboardRouter integration', () => {
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
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, memberId, outsiderId].map((id) => cleanupTestUser(db, id)));
  });

  const createWidget = async (
    caller: ReturnType<typeof dashboardRouter.createCaller>,
    input: Parameters<ReturnType<typeof dashboardRouter.createCaller>['createWidget']>[0] = {
      title: 'Open PRs',
    },
  ) => (await caller.createWidget(input))!.data;

  describe('version flow', () => {
    it('requires a successful dry run of the exact content before publishing', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));
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
      const [afterPreview] = await db
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, widget.id));
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
      const owner = dashboardRouter.createCaller(context(ownerId));
      const board = (await owner.create({ title: 'Ops' }))!.data;
      const widget = await createWidget(owner, { dashboardId: board.id, title: 'Open PRs' });
      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;

      const detail = (await owner.widgetDetail({ id: widget.id }))!.data;
      expect(detail).toMatchObject({
        dashboards: [{ id: board.id, title: 'Ops' }],
        draftVersion: { id: draft.id },
        publishedVersion: null,
      });

      await owner.trash({ id: board.id });
      expect((await owner.widgetDetail({ id: widget.id }))!.data.dashboards).toEqual([]);
    });

    it('publishes v2 over v1 and rolls back to the archived v1', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));
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
    const publishStat = async (
      owner: ReturnType<typeof dashboardRouter.createCaller>,
      extra = {},
    ) => {
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
      const owner = dashboardRouter.createCaller(context(ownerId));
      const widget = await publishStat(owner);

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 42 }));
      const run = (await owner.runWidget({ widgetId: widget.id }))!.data;
      expect(run).toMatchObject({ status: 'succeeded', trigger: 'manual' });

      let [row] = await db
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, widget.id));
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
        subjectType: 'dashboardWidget',
      });

      // Invalid output then a timeout: failures accumulate, last good output stays.
      runSandbox.mockResolvedValueOnce({ ...ok({}), stdout: 'not json' });
      const invalid = (await owner.runWidget({ widgetId: widget.id }))!.data;
      expect(invalid).toMatchObject({ error: { code: 'INVALID_JSON' }, status: 'failed' });
      runSandbox.mockResolvedValueOnce({ ...ok({}), exitCode: 124, stdout: '', timedOut: true });
      const timeout = (await owner.runWidget({ widgetId: widget.id }))!.data;
      expect(timeout).toMatchObject({ error: { code: 'TIMEOUT' }, status: 'timeout' });

      [row] = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.id, widget.id));
      expect(row).toMatchObject({
        consecutiveFailures: 2,
        lastRunError: { code: 'TIMEOUT' },
        lastRunStatus: 'timeout',
        latestOutput: { type: 'stat', value: 42 },
      });

      // A partial result succeeds and renders, but is not a trend sample.
      runSandbox.mockResolvedValueOnce(
        ok({ meta: { complete: false, message: 'one repo failed' }, type: 'stat', value: 40 }),
      );
      const partial = (await owner.runWidget({ widgetId: widget.id }))!.data;
      expect(partial).toMatchObject({
        error: { code: 'PARTIAL_OUTPUT', message: 'one repo failed' },
        status: 'succeeded',
      });
      [row] = await db.select().from(dashboardWidgets).where(eq(dashboardWidgets.id, widget.id));
      expect(row).toMatchObject({ consecutiveFailures: 0, latestOutput: { value: 40 } });
      const pointsAfter = await db
        .select()
        .from(metricPoints)
        .where(eq(metricPoints.metricId, row.metricId!));
      expect(pointsAfter).toHaveLength(1);

      const runs = (await owner.listRuns({ widgetId: widget.id }))!.data;
      expect(runs.map((r) => r.status)).toEqual([
        'succeeded',
        'timeout',
        'failed',
        'succeeded',
        'succeeded',
      ]);
    });

    it('appends only new series points to per-series metrics', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));
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
      await owner.runWidget({ widgetId: widget.id });
      runSandbox.mockResolvedValueOnce(
        series([
          ['2026-09-02', 3],
          ['2026-09-03', 2],
        ]),
      );
      await owner.runWidget({ widgetId: widget.id });

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

    const draftWithEnv = async (
      caller: ReturnType<typeof dashboardRouter.createCaller>,
      widgetId: string,
    ) =>
      (await caller.saveDraft({
        manifest: { env: [{ connector: 'github', name: 'GITHUB_TOKEN' }] },
        widgetId,
        ...statScript,
      }))!.data;

    it('never falls back to the creator personal connector for a workspace widget', async () => {
      await (await gateKeeperModel(ownerId)).create(githubConnector('personal-token-123') as any);
      const owner = dashboardRouter.createCaller(context(ownerId, workspaceId));
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
      const { agents, projects } = await import('@lobechat/database/schemas');
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
      const owner = dashboardRouter.createCaller(context(ownerId, workspaceId));
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

    it('closes the run as failed when credential resolution itself errors', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId, workspaceId));
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
      const owner = dashboardRouter.createCaller(context(ownerId, workspaceId));

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
      const { agents } = await import('@lobechat/database/schemas');
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
      const { projects, topics } = await import('@lobechat/database/schemas');
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
      const owner = dashboardRouter.createCaller(context(ownerId));
      const createArgs = { ...statScript, description: 'Always 7', title: 'Seven' };

      const created = await owner.runAgentTool({
        apiName: 'createWidgetDraft',
        args: createArgs,
        context: { agentId, operationId: 'op_1', topicId: `tpc_own_${ownerId}` },
      });
      expect(created).toMatchObject({ success: true });
      const [widget] = await db
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, created.state.widgetId));
      expect(widget).toMatchObject({ agentId, projectId: project.id, userId: ownerId });

      // Another user's topic id is dropped instead of leaking its project.
      const foreign = await owner.runAgentTool({
        apiName: 'createWidgetDraft',
        args: createArgs,
        context: { agentId, topicId: `tpc_other_${memberId}` },
      });
      const [foreignWidget] = await db
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, foreign.state.widgetId));
      expect(foreignWidget).toMatchObject({ agentId, projectId: null });

      runSandbox.mockResolvedValueOnce(ok({ type: 'stat', value: 7 }));
      const dryRun = await owner.runAgentTool({
        apiName: 'dryRunWidget',
        args: { widgetId: widget.id },
        context: { operationId: 'op_1' },
      });
      expect(dryRun).toMatchObject({ state: { status: 'succeeded' }, success: true });
      expect(dryRun.content).toContain('"value": 7');
    });

    it('rejects unknown tool APIs', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));
      await expect(
        owner.runAgentTool({ apiName: 'publish', args: {} } as any),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('permissions', () => {
    it('lets members read and refresh public widgets but not author them', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId, workspaceId));
      const member = dashboardRouter.createCaller(context(memberId, workspaceId));
      const outsider = dashboardRouter.createCaller(context(outsiderId));

      const board = (await owner.create({ title: 'Team board' }))!.data;
      const widget = await createWidget(owner, { dashboardId: board.id, title: 'CI health' });
      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 1 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });

      const detail = (await member.detail({ id: board.id }))!.data;
      expect(detail.items.map((i) => i.widget.id)).toEqual([widget.id]);
      expect((await member.runWidget({ widgetId: widget.id }))!.data?.status).toBe('succeeded');

      await expect(
        member.saveDraft({ widgetId: widget.id, ...statScript, script: 'x' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        member.publish({ versionId: draft.id, widgetId: widget.id }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(member.update({ id: board.id, value: { title: 'x' } })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      await expect(outsider.widgetDetail({ id: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.runWidget({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.listVersions({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(outsider.listRuns({ widgetId: widget.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      const secret = await createWidget(owner, { title: 'Mine', visibility: 'private' });
      await expect(member.widgetDetail({ id: secret.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect((await member.listWidgets())!.data.map((w) => w.id)).toEqual([widget.id]);
    });

    it('rejects malformed ids before they reach the database', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));

      await expect(owner.widgetDetail({ id: 'not-a-uuid' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('schedule', () => {
    it('validates cron patterns and fires due widgets once per slot from the tick route', async () => {
      const owner = dashboardRouter.createCaller(context(ownerId));
      const widget = await createWidget(owner);

      await expect(
        owner.setWidgetSchedule({ id: widget.id, pattern: '* * *' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const scheduled = (await owner.setWidgetSchedule({
        id: widget.id,
        pattern: '*/5 * * * *',
        timezone: 'Asia/Shanghai',
      }))!.data;
      expect(scheduled.nextRunAt).toBeInstanceOf(Date);

      // Not published yet: nothing is due.
      await db
        .update(dashboardWidgets)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(dashboardWidgets.id, widget.id));
      expect(await runDashboardSchedulerTick(db, { runner: { run: runSandbox } })).toMatchObject({
        due: 0,
      });

      const draft = (await owner.saveDraft({ widgetId: widget.id, ...statScript }))!.data;
      runSandbox.mockResolvedValue(ok({ type: 'stat', value: 5 }));
      await owner.dryRun({ widgetId: widget.id });
      await owner.publish({ versionId: draft.id, widgetId: widget.id });
      await db
        .update(dashboardWidgets)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(eq(dashboardWidgets.id, widget.id));

      const response = await dashboardWorkflowApp.request('/tick', {
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

      const [row] = await db
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, widget.id));
      expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(row.latestOutput).toEqual({ type: 'stat', value: 5 });
      const runs = await db
        .select()
        .from(dashboardWidgetRuns)
        .where(
          and(
            eq(dashboardWidgetRuns.widgetId, widget.id),
            eq(dashboardWidgetRuns.trigger, 'schedule'),
          ),
        );
      expect(runs).toHaveLength(1);

      // The slot moved forward, so an immediate second tick has nothing to do.
      const second = await dashboardWorkflowApp.request('/tick', { body: '{}', method: 'POST' });
      expect(await second.json()).toMatchObject({ claimed: 0, due: 0 });
    });
  });
});
