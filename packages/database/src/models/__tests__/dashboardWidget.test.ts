// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  dashboardWidgetRuns,
  dashboardWidgets,
  dashboardWidgetVersions,
  metrics,
  trashItems,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { CreateDashboardWidgetVersionInput } from '../dashboardWidget';
import { computeWidgetContentHash, DashboardWidgetModel } from '../dashboardWidget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'dashboard-widget-user';
const otherUserId = 'dashboard-widget-other-user';
const workspaceId = 'dashboard-widget-ws';

const script = (n: number): CreateDashboardWidgetVersionInput => ({
  manifest: { network: { allow: ['api.github.com'] }, title: `v${n}` },
  outputType: 'stat',
  runtime: 'node',
  script: `console.log(JSON.stringify({ type: 'stat', value: ${n} }))`,
  sourceType: 'agent',
  view: { size: 'sm' },
});

beforeEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'dashboard-widget-ws' });
});

afterEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('DashboardWidgetModel', () => {
  const model = new DashboardWidgetModel(serverDB, userId);
  const other = new DashboardWidgetModel(serverDB, otherUserId);

  describe('widgets', () => {
    it('creates, reads, updates and isolates widgets by owner', async () => {
      const widget = await model.create({
        schedulePattern: '0 * * * *',
        scheduleTimezone: 'Asia/Shanghai',
        title: 'Open PRs',
      });
      expect(widget).toMatchObject({
        consecutiveFailures: 0,
        draftVersionId: null,
        publishedVersionId: null,
        schedulePattern: '0 * * * *',
        userId,
        workspaceId: null,
      });

      expect(await other.findById(widget.id)).toBeUndefined();
      expect(await other.update(widget.id, { title: 'x' })).toBeUndefined();

      const [metric] = await serverDB
        .insert(metrics)
        .values({ key: 'prs', subjectId: widget.id, subjectType: 'dashboardWidget', userId })
        .returning();
      const next = new Date('2030-01-01T00:00:00Z');
      const updated = await model.update(widget.id, {
        metricId: metric.id,
        nextRunAt: next,
        title: 'PRs',
      });
      expect(updated).toMatchObject({ metricId: metric.id, nextRunAt: next, title: 'PRs' });

      // metric deletion detaches the trend without touching the widget
      await serverDB.delete(metrics).where(eq(metrics.id, metric.id));
      expect((await model.findById(widget.id))?.metricId).toBeNull();
    });

    it('lists by direct level and validates scope', async () => {
      await serverDB.insert(agents).values([
        { id: 'widget-agent-ws', userId, workspaceId },
        { id: 'widget-agent-personal', userId, workspaceId: null },
      ]);
      const ws = new DashboardWidgetModel(serverDB, userId, workspaceId);

      const direct = await ws.create({ title: 'ws' });
      const byAgent = await ws.create({ agentId: 'widget-agent-ws', title: 'agent' });
      await expect(
        ws.create({ agentId: 'widget-agent-personal', title: 'x' }),
      ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });

      expect((await ws.list()).map((w) => w.id)).toEqual([direct.id]);
      expect((await ws.list({ agentId: 'widget-agent-ws' })).map((w) => w.id)).toEqual([
        byAgent.id,
      ]);
      expect(await model.list()).toEqual([]);

      await serverDB.delete(agents).where(eq(agents.id, 'widget-agent-ws'));
      expect(await ws.findById(byAgent.id)).toBeUndefined();
    });

    it('trash / restore / delete go through the recycle bin', async () => {
      const widget = await model.create({ title: 'w' });
      await model.publishVersion(widget.id, (await model.createVersion(widget.id, script(1)))!.id);

      expect(await other.trash(widget.id)).toBeUndefined();
      expect(await model.trash(widget.id)).toMatchObject({ isDeleted: true });
      expect(await model.findById(widget.id)).toBeUndefined();
      expect(await serverDB.select().from(trashItems)).toEqual([
        expect.objectContaining({ resourceId: widget.id, resourceType: 'dashboardWidget' }),
      ]);

      expect(await model.restore(widget.id)).toMatchObject({ isDeleted: null });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
      expect(await model.restore(widget.id)).toBeUndefined();

      await model.trash(widget.id);
      expect(await other.delete(widget.id)).toBeUndefined();
      expect(await model.delete(widget.id)).toMatchObject({ id: widget.id });
      expect(await serverDB.select().from(dashboardWidgetVersions)).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
      expect(await model.delete(widget.id)).toBeUndefined();
    });
  });

  describe('versions', () => {
    it('creates numbered drafts, dedupes identical content, and chains parents', async () => {
      const widget = await model.create({ title: 'w' });

      const v1 = await model.createVersion(widget.id, script(1));
      expect(v1).toMatchObject({
        contentHash: computeWidgetContentHash(script(1)),
        parentVersionId: null,
        status: 'draft',
        userId,
        version: 1,
      });
      expect((await model.findById(widget.id))?.draftVersionId).toBe(v1!.id);

      // identical content returns the current draft
      expect((await model.createVersion(widget.id, script(1)))?.id).toBe(v1!.id);

      const v2 = await model.createVersion(widget.id, {
        ...script(2),
        changeNote: 'bump',
        sourceOperationId: 'op_1',
        sourceType: 'user',
      });
      expect(v2).toMatchObject({ parentVersionId: v1!.id, sourceType: 'user', version: 2 });

      expect((await model.listVersions(widget.id)).map((v) => v.version)).toEqual([2, 1]);
      expect(await model.findVersion(widget.id, v1!.id)).toMatchObject({ id: v1!.id });
      expect(await other.listVersions(widget.id)).toEqual([]);
      expect(await other.findVersion(widget.id, v1!.id)).toBeUndefined();
      expect(await other.createVersion(widget.id, script(3))).toBeUndefined();
    });

    it('hash is key-order independent and sensitive to script changes', () => {
      const a = computeWidgetContentHash({
        manifest: { network: { allow: ['a'] }, timeoutMs: 1000 },
        outputType: 'stat',
        runtime: 'node',
        script: 'x',
      });
      const b = computeWidgetContentHash({
        manifest: { timeoutMs: 1000, network: { allow: ['a'] } },
        outputType: 'stat',
        runtime: 'node',
        script: 'x',
      });
      expect(a).toBe(b);
      expect(a).not.toBe(
        computeWidgetContentHash({ outputType: 'stat', runtime: 'node', script: 'y' }),
      );
    });

    it('publishes a version, archives the previous one and sets the schedule', async () => {
      const widget = await model.create({ schedulePattern: '*/5 * * * *', title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      const next = new Date('2030-01-01T00:05:00Z');

      const first = await model.publishVersion(widget.id, v1!.id, { nextRunAt: next });
      expect(first?.version).toMatchObject({ publishedByUserId: userId, status: 'published' });
      expect(first?.version.publishedAt).toBeInstanceOf(Date);
      expect(first?.widget).toMatchObject({
        draftVersionId: null,
        nextRunAt: next,
        publishedVersionId: v1!.id,
      });

      const v2 = await model.createVersion(widget.id, script(2));
      const v3 = await model.createVersion(widget.id, script(3));
      // publishing a non-draft version keeps the current draft pointer
      const second = await model.publishVersion(widget.id, v2!.id);
      expect(second?.widget).toMatchObject({
        draftVersionId: v3!.id,
        nextRunAt: next,
        publishedVersionId: v2!.id,
      });
      expect((await model.findVersion(widget.id, v1!.id))?.status).toBe('archived');

      expect(await other.publishVersion(widget.id, v3!.id)).toBeUndefined();
      expect(
        await model.publishVersion(widget.id, '00000000-0000-0000-0000-000000000000'),
      ).toBeUndefined();
    });
  });

  describe('runs', () => {
    it('finds a run by id only through a readable widget', async () => {
      const widget = await model.create({ title: 'w' });
      await model.createVersion(widget.id, script(1));
      const run = await model.startRun(widget.id, { trigger: 'preview' });

      expect(await model.findRun(widget.id, run!.id)).toMatchObject({ id: run!.id });
      expect(await other.findRun(widget.id, run!.id)).toBeUndefined();
    });

    it('tracks succeeded runs by content hash across version rows', async () => {
      const widget = await model.create({ title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      await model.createVersion(widget.id, script(2));
      // Back to v1's content: a new draft row with the same hash.
      const v3 = await model.createVersion(widget.id, script(1));
      expect(v3!.id).not.toBe(v1!.id);
      expect(v3!.contentHash).toBe(v1!.contentHash);

      expect(await model.hasSucceededRunForContentHash(widget.id, v1!.contentHash)).toBe(false);

      const failed = await model.startRun(widget.id, { trigger: 'preview', versionId: v1!.id });
      await model.finishRun(failed!.id, { status: 'failed' });
      expect(await model.hasSucceededRunForContentHash(widget.id, v1!.contentHash)).toBe(false);

      const ok = await model.startRun(widget.id, { trigger: 'preview', versionId: v1!.id });
      await model.finishRun(ok!.id, { status: 'succeeded' });
      expect(await model.hasSucceededRunForContentHash(widget.id, v3!.contentHash)).toBe(true);
      expect(await other.hasSucceededRunForContentHash(widget.id, v1!.contentHash)).toBe(false);
    });

    it('preview runs use the draft and never touch the widget snapshot', async () => {
      const widget = await model.create({ title: 'w' });
      const draft = await model.createVersion(widget.id, script(1));

      const run = await model.startRun(widget.id, { operationId: 'op_x', trigger: 'preview' });
      expect(run).toMatchObject({
        operationId: 'op_x',
        status: 'running',
        trigger: 'preview',
        versionId: draft!.id,
      });

      const finished = await model.finishRun(run!.id, {
        exitCode: 0,
        output: { type: 'stat', value: 1 },
        sandboxId: 'sbx_1',
        status: 'succeeded',
        stdout: '{"type":"stat","value":1}',
      });
      expect(finished).toMatchObject({ exitCode: 0, sandboxId: 'sbx_1', status: 'succeeded' });
      expect(finished!.durationMs).toBeGreaterThanOrEqual(0);

      const after = await model.findById(widget.id);
      expect(after).toMatchObject({ lastRunId: null, latestOutput: null });
    });

    it('manual and scheduled runs update last-run fields and the failure streak', async () => {
      const widget = await model.create({ title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      await expect(model.startRun(widget.id, { trigger: 'manual' })).rejects.toThrow(
        'no version to run',
      );
      await model.publishVersion(widget.id, v1!.id);

      const ok = await model.startRun(widget.id, { trigger: 'manual' });
      await model.finishRun(ok!.id, {
        durationMs: 120,
        output: { type: 'stat', value: 42 },
        status: 'succeeded',
      });
      let w = await model.findById(widget.id);
      expect(w).toMatchObject({
        consecutiveFailures: 0,
        lastRunId: ok!.id,
        lastRunStatus: 'succeeded',
        latestOutput: { type: 'stat', value: 42 },
      });

      for (const status of ['failed', 'timeout'] as const) {
        const bad = await DashboardWidgetModel.startRun(serverDB, w!, { trigger: 'schedule' });
        await DashboardWidgetModel.finishRun(serverDB, bad.id, {
          error: { code: 'NON_ZERO_EXIT', message: 'boom' },
          exitCode: 1,
          status,
          stderr: 'boom',
        });
      }
      w = await model.findById(widget.id);
      expect(w).toMatchObject({
        consecutiveFailures: 2,
        lastRunError: { code: 'NON_ZERO_EXIT', message: 'boom' },
        lastRunStatus: 'timeout',
        // the last good output survives failures
        latestOutput: { type: 'stat', value: 42 },
      });

      // finishing twice is a no-op
      expect(await model.finishRun(ok!.id, { status: 'failed' })).toBeUndefined();

      const runs = await model.listRuns(widget.id);
      expect(runs).toHaveLength(3);
      expect(runs.every((r) => r.userId === userId && r.versionId === v1!.id)).toBe(true);
      expect(await model.listRuns(widget.id, { limit: 1 })).toHaveLength(1);
    });

    it('lets workspace readers run a public widget but not a private one', async () => {
      const owner = new DashboardWidgetModel(serverDB, userId, workspaceId);
      const member = new DashboardWidgetModel(serverDB, otherUserId, workspaceId);
      const pub = await owner.create({ title: 'pub' });
      const priv = await owner.create({ title: 'priv', visibility: 'private' });
      for (const w of [pub, priv]) {
        await owner.publishVersion(w.id, (await owner.createVersion(w.id, script(1)))!.id);
      }

      const run = await member.startRun(pub.id, { trigger: 'manual' });
      // run ownership follows the widget, not the actor
      expect(run).toMatchObject({ userId, workspaceId });
      expect(await member.finishRun(run!.id, { status: 'succeeded' })).toMatchObject({
        status: 'succeeded',
      });

      expect(await member.startRun(priv.id, { trigger: 'manual' })).toBeUndefined();
      const privRun = await owner.startRun(priv.id, { trigger: 'manual' });
      expect(await member.finishRun(privRun!.id, { status: 'succeeded' })).toBeUndefined();
      expect(await member.listRuns(priv.id)).toEqual([]);
    });

    it('rejects a version that belongs to another widget', async () => {
      const a = await model.create({ title: 'a' });
      const b = await model.create({ title: 'b' });
      const vb = await model.createVersion(b.id, script(1));

      await expect(model.startRun(a.id, { trigger: 'preview', versionId: vb!.id })).rejects.toThrow(
        'does not belong',
      );
      expect(
        await model.startRun('00000000-0000-0000-0000-000000000000', { trigger: 'manual' }),
      ).toBeUndefined();
    });
  });

  describe('scheduler', () => {
    it('loads a live widget with its published version and links its metric', async () => {
      const widget = await model.create({ title: 'w' });
      expect(
        await DashboardWidgetModel.findLiveWithPublishedVersion(serverDB, widget.id),
      ).toBeUndefined();

      const v1 = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, v1!.id);
      const live = await DashboardWidgetModel.findLiveWithPublishedVersion(serverDB, widget.id);
      expect(live).toMatchObject({ version: { id: v1!.id }, widget: { id: widget.id } });

      const [metric] = await serverDB
        .insert(metrics)
        .values({ key: 'value', subjectId: widget.id, subjectType: 'dashboardWidget', userId })
        .returning();
      await DashboardWidgetModel.linkMetric(serverDB, widget.id, metric.id);
      expect((await model.findById(widget.id))!.metricId).toBe(metric.id);

      await model.trash(widget.id);
      expect(
        await DashboardWidgetModel.findLiveWithPublishedVersion(serverDB, widget.id),
      ).toBeUndefined();
    });

    it('finds due widgets across users and claims each slot once', async () => {
      const now = new Date('2030-01-01T01:00:00Z');
      const past = new Date('2030-01-01T00:00:00Z');
      const future = new Date('2030-01-01T02:00:00Z');

      const make = async (
        m: DashboardWidgetModel,
        title: string,
        opts: { publish?: boolean; nextRunAt?: Date | null; schedule?: string | null },
      ) => {
        const w = await m.create({ schedulePattern: opts.schedule ?? null, title });
        const v = await m.createVersion(w.id, script(title.length));
        if (opts.publish !== false) await m.publishVersion(w.id, v!.id);
        await m.update(w.id, { nextRunAt: opts.nextRunAt ?? null });
        return w;
      };

      const due = await make(model, 'due', { nextRunAt: past, schedule: '0 * * * *' });
      const otherDue = await make(other, 'other-due', {
        nextRunAt: new Date('2030-01-01T00:30:00Z'),
        schedule: '0 * * * *',
      });
      await make(model, 'future', { nextRunAt: future, schedule: '0 * * * *' });
      await make(model, 'unscheduled', { nextRunAt: past, schedule: null });
      await make(model, 'unpublished', { nextRunAt: past, publish: false, schedule: '0 * * * *' });
      const trashed = await make(model, 'trashed', { nextRunAt: past, schedule: '0 * * * *' });
      await model.trash(trashed.id);

      const found = await DashboardWidgetModel.findDue(serverDB, { now });
      expect(found.map((r) => r.widget.id)).toEqual([due.id, otherDue.id]);
      expect(found[0].version.id).toBe(found[0].widget.publishedVersionId);
      expect(await DashboardWidgetModel.findDue(serverDB, { limit: 1, now })).toHaveLength(1);

      const claim = { expectedNextRunAt: past, nextRunAt: future, widgetId: due.id };
      expect(await DashboardWidgetModel.claimDue(serverDB, claim)).toBe(true);
      expect(await DashboardWidgetModel.claimDue(serverDB, claim)).toBe(false);

      const remaining = await DashboardWidgetModel.findDue(serverDB, { now });
      expect(remaining.map((r) => r.widget.id)).toEqual([otherDue.id]);

      const [row] = await serverDB
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.id, due.id));
      expect(row.nextRunAt).toEqual(future);
      expect(await serverDB.select().from(dashboardWidgetRuns)).toHaveLength(0);
    });
  });
});
