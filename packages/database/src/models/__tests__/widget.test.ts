// @vitest-environment node
import { eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  metrics,
  projects,
  trashItems,
  users,
  widgetRuns,
  widgets,
  widgetVersions,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ScopeLevelError } from '../../utils/scopeLevel';
import type { CreateWidgetVersionInput } from '../widget';
import { computeWidgetContentHash, WidgetModel } from '../widget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'widget-user';
const otherUserId = 'widget-other-user';
const workspaceId = 'widget-ws';
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';

const script = (n: number): CreateWidgetVersionInput => ({
  manifest: { network: { allow: ['api.github.com'] }, title: `v${n}` },
  outputType: 'stat',
  runtime: 'node',
  script: `console.log(JSON.stringify({ type: 'stat', value: ${n} }))`,
  sourceType: 'agent',
  view: { size: 'sm' },
});

let projectSeq = 0;
const seedProject = async (
  id: string,
  opts: { owner?: string; visibility?: 'private' | 'public'; workspaceId?: string | null } = {},
) => {
  const owner = opts.owner ?? userId;
  const ws = opts.workspaceId === undefined ? workspaceId : opts.workspaceId;
  await serverDB.insert(agents).values({ id: `${id}-coord`, userId: owner, workspaceId: ws });
  await serverDB.insert(projects).values({
    coordinatorAgentId: `${id}-coord`,
    id,
    // unique per (workspace, identifier)
    identifier: `WGT${(projectSeq += 1)}`,
    name: id,
    userId: owner,
    visibility: opts.visibility ?? 'public',
    workspaceId: ws,
  });
};

beforeEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'widget-ws' });
});

afterEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('WidgetModel', () => {
  const model = new WidgetModel(serverDB, userId);
  const other = new WidgetModel(serverDB, otherUserId);
  const ws = new WidgetModel(serverDB, userId, workspaceId);
  const member = new WidgetModel(serverDB, otherUserId, workspaceId);

  describe('widgets', () => {
    it('creates, reads, updates and isolates widgets by owner', async () => {
      const widget = await model.create({
        schedulePattern: '0 * * * *',
        scheduleTimezone: 'Asia/Shanghai',
        title: 'Open PRs',
      });
      expect(widget).toMatchObject({
        agentId: null,
        consecutiveFailures: 0,
        draftVersionId: null,
        projectId: null,
        publishedVersionId: null,
        schedulePattern: '0 * * * *',
        userId,
        visibility: 'public',
        workspaceId: null,
      });

      expect(await other.findById(widget.id)).toBeUndefined();
      expect(await other.update(widget.id, { title: 'x' })).toBeUndefined();
      expect(await model.findById('not-a-uuid')).toBeUndefined();

      const [metric] = await serverDB
        .insert(metrics)
        .values({ key: 'prs', subjectId: widget.id, subjectType: 'widget', userId })
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

    it('lists each direct level: personal, workspace, project, agent, project + agent', async () => {
      await seedProject('wgt-proj');
      await serverDB.insert(agents).values({ id: 'wgt-agent', userId, workspaceId });

      const personal = await model.create({ title: 'personal' });
      const direct = await ws.create({ title: 'workspace' });
      const byProject = await ws.create({ projectId: 'wgt-proj', title: 'project' });
      const byAgent = await ws.create({ agentId: 'wgt-agent', title: 'agent' });
      const both = await ws.create({ agentId: 'wgt-agent', projectId: 'wgt-proj', title: 'both' });
      expect(both).toMatchObject({ agentId: 'wgt-agent', projectId: 'wgt-proj', workspaceId });

      const ids = (rows: { id: string }[]) => rows.map((w) => w.id);
      expect(ids(await model.list())).toEqual([personal.id]);
      expect(ids(await ws.list())).toEqual([direct.id]);
      expect(ids(await ws.list({ projectId: 'wgt-proj' }))).toEqual([byProject.id]);
      expect(ids(await ws.list({ agentId: 'wgt-agent' }))).toEqual([byAgent.id]);
      expect(ids(await ws.list({ agentId: 'wgt-agent', projectId: 'wgt-proj' }))).toEqual([
        both.id,
      ]);

      // agent deletion cascades its widgets
      await serverDB.delete(agents).where(eq(agents.id, 'wgt-agent'));
      expect(await ws.findById(byAgent.id)).toBeUndefined();
      expect(await ws.findById(both.id)).toBeUndefined();
    });

    it('rejects parents from another workspace, missing parents and invisible parents', async () => {
      await serverDB.insert(agents).values({ id: 'wgt-agent-personal', userId, workspaceId: null });
      await seedProject('wgt-proj-personal', { workspaceId: null });
      await seedProject('wgt-proj-private-other', { owner: otherUserId, visibility: 'private' });

      await expect(ws.create({ agentId: 'wgt-agent-personal', title: 'x' })).rejects.toMatchObject({
        code: 'SCOPE_MISMATCH',
      });
      await expect(
        ws.create({ projectId: 'wgt-proj-personal', title: 'x' }),
      ).rejects.toBeInstanceOf(ScopeLevelError);
      await expect(ws.create({ projectId: 'wgt-proj-personal', title: 'x' })).rejects.toMatchObject(
        { code: 'SCOPE_MISMATCH' },
      );
      await expect(ws.create({ agentId: 'nope', title: 'x' })).rejects.toMatchObject({
        code: 'AGENT_NOT_FOUND',
      });
      await expect(ws.create({ projectId: 'nope', title: 'x' })).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      // a teammate's private project is not visible, so it cannot be a parent
      await expect(
        ws.create({ projectId: 'wgt-proj-private-other', title: 'x' }),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
      expect(await serverDB.select().from(widgets)).toHaveLength(0);
    });

    it('forces private visibility under a private project or agent', async () => {
      await seedProject('wgt-proj-private', { visibility: 'private' });
      await seedProject('wgt-proj-public');
      await serverDB
        .insert(agents)
        .values({ id: 'wgt-agent-private', userId, visibility: 'private', workspaceId });

      const inPrivateProject = await ws.create({
        projectId: 'wgt-proj-private',
        title: 'p',
        visibility: 'public',
      });
      const inPrivateAgent = await ws.create({
        agentId: 'wgt-agent-private',
        projectId: 'wgt-proj-public',
        title: 'a',
      });
      const inPublicProject = await ws.create({ projectId: 'wgt-proj-public', title: 'pub' });
      expect(inPrivateProject.visibility).toBe('private');
      expect(inPrivateAgent.visibility).toBe('private');
      expect(inPublicProject.visibility).toBe('public');

      // cannot be widened later either
      expect((await ws.update(inPrivateProject.id, { visibility: 'public' }))?.visibility).toBe(
        'private',
      );
      expect((await ws.update(inPublicProject.id, { visibility: 'private' }))?.visibility).toBe(
        'private',
      );
      expect((await ws.update(inPublicProject.id, { visibility: 'public' }))?.visibility).toBe(
        'public',
      );

      // teammates never see them
      expect(await member.findById(inPrivateProject.id)).toBeUndefined();
      expect(await member.findById(inPrivateAgent.id)).toBeUndefined();
      expect((await member.findById(inPublicProject.id))?.id).toBe(inPublicProject.id);
    });

    it('honors the current visibility of the parent project / agent on every read', async () => {
      // Parents start public, so the widgets are created public …
      await seedProject('wgt-proj-flip');
      await serverDB.insert(agents).values({ id: 'wgt-agent-flip', userId, workspaceId });
      const inProject = await ws.create({ projectId: 'wgt-proj-flip', title: 'p' });
      const inAgent = await ws.create({ agentId: 'wgt-agent-flip', title: 'a' });
      expect([inProject.visibility, inAgent.visibility]).toEqual(['public', 'public']);

      const v1 = await ws.createVersion(inProject.id, script(1));
      await ws.publishVersion(inProject.id, v1!.id);
      const run = await ws.startRun(inProject.id, { trigger: 'manual' });
      await ws.finishRun(run!.id, { status: 'succeeded' });
      expect((await member.findById(inProject.id))?.id).toBe(inProject.id);

      // … then the parents turn private: the widget rows still say public.
      await serverDB
        .update(projects)
        .set({ visibility: 'private' })
        .where(eq(projects.id, 'wgt-proj-flip'));
      await serverDB
        .update(agents)
        .set({ visibility: 'private' })
        .where(eq(agents.id, 'wgt-agent-flip'));

      expect(await member.findById(inProject.id)).toBeUndefined();
      expect(await member.findById(inAgent.id)).toBeUndefined();
      expect(await member.list({ projectId: 'wgt-proj-flip' })).toEqual([]);
      expect(await member.list({ agentId: 'wgt-agent-flip' })).toEqual([]);
      expect(await member.listByProject('wgt-proj-flip')).toEqual([]);
      expect(await member.listVersions(inProject.id)).toEqual([]);
      expect(await member.findVersion(inProject.id, v1!.id)).toBeUndefined();
      expect(await member.listRuns(inProject.id)).toEqual([]);
      expect(await member.findRun(inProject.id, run!.id)).toBeUndefined();
      expect(await member.startRun(inProject.id, { trigger: 'manual' })).toBeUndefined();
      expect(await member.hasSucceededRunForContentHash(inProject.id, v1!.contentHash)).toBe(false);

      // the parents' creator still sees everything
      expect((await ws.findById(inProject.id))?.id).toBe(inProject.id);
      expect((await ws.listByProject('wgt-proj-flip')).map((w) => w.id)).toEqual([inProject.id]);
      expect(await ws.listRuns(inProject.id)).toHaveLength(1);
    });

    it('hides widgets while their project or agent is trashed, in personal and workspace mode', async () => {
      const setTrashed = async (trashed: boolean) => {
        const stamp = trashed
          ? { deletedAt: new Date(), isDeleted: true }
          : { deletedAt: null, isDeleted: null };
        await serverDB.update(projects).set(stamp).where(eq(projects.id, 'wgt-proj-bin'));
        await serverDB.update(agents).set(stamp).where(eq(agents.id, 'wgt-agent-bin'));
        await serverDB.update(projects).set(stamp).where(eq(projects.id, 'wgt-proj-bin-ws'));
        await serverDB.update(agents).set(stamp).where(eq(agents.id, 'wgt-agent-bin-ws'));
      };

      // personal mode: the caller owns every parent
      await seedProject('wgt-proj-bin', { workspaceId: null });
      await serverDB.insert(agents).values({ id: 'wgt-agent-bin', userId, workspaceId: null });
      const inProject = await model.create({ projectId: 'wgt-proj-bin', title: 'p' });
      const inAgent = await model.create({ agentId: 'wgt-agent-bin', title: 'a' });
      const v1 = await model.createVersion(inProject.id, script(1));
      await model.publishVersion(inProject.id, v1!.id);
      const run = await model.startRun(inProject.id, { trigger: 'manual' });

      // workspace mode: public parents, read by a teammate
      await seedProject('wgt-proj-bin-ws');
      await serverDB.insert(agents).values({ id: 'wgt-agent-bin-ws', userId, workspaceId });
      const wsInProject = await ws.create({ projectId: 'wgt-proj-bin-ws', title: 'wp' });
      const wsInAgent = await ws.create({ agentId: 'wgt-agent-bin-ws', title: 'wa' });

      await setTrashed(true);

      expect(await model.findById(inProject.id)).toBeUndefined();
      expect(await model.findById(inAgent.id)).toBeUndefined();
      expect(await model.list({ projectId: 'wgt-proj-bin' })).toEqual([]);
      expect(await model.list({ agentId: 'wgt-agent-bin' })).toEqual([]);
      expect(await model.listByProject('wgt-proj-bin')).toEqual([]);
      expect(await model.listVersions(inProject.id)).toEqual([]);
      expect(await model.findVersion(inProject.id, v1!.id)).toBeUndefined();
      expect(await model.listRuns(inProject.id)).toEqual([]);
      expect(await model.findRun(inProject.id, run!.id)).toBeUndefined();
      expect(await model.startRun(inProject.id, { trigger: 'manual' })).toBeUndefined();
      for (const reader of [ws, member]) {
        expect(await reader.findById(wsInProject.id)).toBeUndefined();
        expect(await reader.findById(wsInAgent.id)).toBeUndefined();
        expect(await reader.listByProject('wgt-proj-bin-ws')).toEqual([]);
        expect(await reader.list({ agentId: 'wgt-agent-bin-ws' })).toEqual([]);
      }

      // restoring the parents brings the widgets back
      await setTrashed(false);

      expect((await model.findById(inProject.id))?.id).toBe(inProject.id);
      expect((await model.findById(inAgent.id))?.id).toBe(inAgent.id);
      expect((await model.listByProject('wgt-proj-bin')).map((w) => w.id)).toEqual([inProject.id]);
      expect(await model.listRuns(inProject.id)).toHaveLength(1);
      expect((await member.findById(wsInProject.id))?.id).toBe(wsInProject.id);
      expect((await member.list({ agentId: 'wgt-agent-bin-ws' })).map((w) => w.id)).toEqual([
        wsInAgent.id,
      ]);
    });

    it('hides a widget from its own creator once a teammate makes the parent private', async () => {
      await seedProject('wgt-proj-teammate', { owner: otherUserId });
      const widget = await ws.create({ projectId: 'wgt-proj-teammate', title: 'mine' });
      expect((await ws.findById(widget.id))?.id).toBe(widget.id);

      await serverDB
        .update(projects)
        .set({ visibility: 'private' })
        .where(eq(projects.id, 'wgt-proj-teammate'));

      expect(await ws.findById(widget.id)).toBeUndefined();
      expect(await ws.update(widget.id, { title: 'x' })).toBeUndefined();
      expect((await member.findById(widget.id))?.id).toBe(widget.id);
    });

    it('lists every widget of a project, with or without an agent', async () => {
      await seedProject('wgt-proj-all');
      await serverDB.insert(agents).values({ id: 'wgt-agent-all', userId, workspaceId });
      const direct = await ws.create({ projectId: 'wgt-proj-all', title: 'direct' });
      const viaAgent = await ws.create({
        agentId: 'wgt-agent-all',
        projectId: 'wgt-proj-all',
        title: 'agent',
      });
      await ws.create({ title: 'elsewhere' });

      expect((await ws.listByProject('wgt-proj-all')).map((w) => w.id).sort()).toEqual(
        [direct.id, viaAgent.id].sort(),
      );
    });

    it('applies visibility in workspace mode and limits writes to the creator', async () => {
      const pub = await ws.create({ title: 'pub' });
      const priv = await ws.create({ title: 'priv', visibility: 'private' });

      expect((await member.list()).map((w) => w.id)).toEqual([pub.id]);
      expect((await ws.list()).map((w) => w.id).sort()).toEqual([pub.id, priv.id].sort());
      expect(await member.findById(priv.id)).toBeUndefined();

      // readable is not manageable
      expect(await member.update(pub.id, { title: 'hijack' })).toBeUndefined();
      expect(await member.trash(pub.id)).toBeUndefined();
      expect(await member.createVersion(pub.id, script(1))).toBeUndefined();
      // personal mode does not see workspace rows
      expect(await model.findById(pub.id)).toBeUndefined();
    });

    it('purge deletes only a widget that is still trashed', async () => {
      const widget = await model.create({ title: 'w' });
      await model.trash(widget.id);
      // a restore commits before the purge reaches the row
      await model.restore(widget.id);

      expect(await model.purge(widget.id)).toBeUndefined();
      expect(await model.findById(widget.id)).toMatchObject({ id: widget.id });

      await model.trash(widget.id);
      expect(await other.purge(widget.id)).toBeUndefined();
      expect(await model.purge(widget.id)).toMatchObject({ id: widget.id });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
    });

    it('trash / restore / delete go through the recycle bin', async () => {
      const widget = await model.create({ title: 'w' });
      await model.publishVersion(widget.id, (await model.createVersion(widget.id, script(1)))!.id);

      expect(await other.trash(widget.id)).toBeUndefined();
      expect(await model.trash(widget.id)).toMatchObject({ isDeleted: true });
      expect(await model.findById(widget.id)).toBeUndefined();
      expect(await model.list()).toEqual([]);
      expect(await serverDB.select().from(trashItems)).toEqual([
        expect.objectContaining({
          resourceId: widget.id,
          resourceType: 'widget',
          rootId: null,
          title: 'w',
          userId,
        }),
      ]);

      expect(await other.restore(widget.id)).toBeUndefined();
      expect(await model.restore(widget.id)).toMatchObject({ deletedAt: null, isDeleted: null });
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
      expect(await model.restore(widget.id)).toBeUndefined();

      await model.trash(widget.id);
      expect(await other.delete(widget.id)).toBeUndefined();
      expect(await model.delete(widget.id)).toMatchObject({ id: widget.id });
      expect(await serverDB.select().from(widgetVersions)).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
      expect(await model.delete(widget.id)).toBeUndefined();
      expect(await model.trash('bad')).toBeUndefined();
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
      expect(await model.publishVersion(widget.id, MISSING_UUID)).toBeUndefined();
    });
  });

  describe('runs', () => {
    it('finds a run by id only through a readable widget', async () => {
      const widget = await model.create({ title: 'w' });
      await model.createVersion(widget.id, script(1));
      const run = await model.startRun(widget.id, { trigger: 'preview' });

      expect(await model.findRun(widget.id, run!.id)).toMatchObject({ id: run!.id });
      expect(await other.findRun(widget.id, run!.id)).toBeUndefined();
      expect(await model.findRun(widget.id, MISSING_UUID)).toBeUndefined();
    });

    it('tracks usable runs by content hash across version rows', async () => {
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

      const partial = await model.startRun(widget.id, { trigger: 'preview', versionId: v1!.id });
      await model.finishRun(partial!.id, { status: 'partial' });
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

      const failing = await model.startRun(widget.id, { trigger: 'preview' });
      await model.finishRun(failing!.id, { status: 'failed' });

      expect(await model.findById(widget.id)).toMatchObject({
        consecutiveFailures: 0,
        lastRunId: null,
        lastRunStatus: null,
        latestOutput: null,
      });
    });

    it('folds manual / scheduled runs into the snapshot: succeeded, failed, timeout, partial', async () => {
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
        const bad = await WidgetModel.startRun(serverDB, w!, { trigger: 'schedule' });
        await WidgetModel.finishRun(serverDB, bad.id, {
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

      // a partial result is shown and ends the failure streak
      const partialOutput = {
        meta: { complete: false, message: 'GitLab API down' },
        type: 'stat' as const,
        value: 7,
      };
      const partial = await WidgetModel.startRun(serverDB, w!, { trigger: 'schedule' });
      await WidgetModel.finishRun(serverDB, partial.id, {
        output: partialOutput,
        status: 'partial',
      });
      w = await model.findById(widget.id);
      expect(w).toMatchObject({
        consecutiveFailures: 0,
        lastRunError: null,
        lastRunId: partial.id,
        lastRunStatus: 'partial',
        latestOutput: partialOutput,
      });
      expect(w!.latestOutputAt).toBeInstanceOf(Date);

      // finishing twice is a no-op
      expect(await model.finishRun(ok!.id, { status: 'failed' })).toBeUndefined();
      expect(await model.finishRun(MISSING_UUID, { status: 'failed' })).toBeUndefined();

      const runs = await model.listRuns(widget.id);
      expect(runs).toHaveLength(4);
      expect(runs.every((r) => r.userId === userId && r.versionId === v1!.id)).toBe(true);
      expect(await model.listRuns(widget.id, { limit: 1 })).toHaveLength(1);
      expect(await other.listRuns(widget.id)).toEqual([]);
    });

    it('does not fold a run that started before the snapshot run into the widget', async () => {
      const widget = await model.create({ title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, v1!.id);

      const older = await model.startRun(widget.id, { trigger: 'manual' });
      const newer = await model.startRun(widget.id, { trigger: 'schedule' });
      await serverDB
        .update(widgetRuns)
        .set({ startedAt: new Date(Date.now() - 120_000) })
        .where(eq(widgetRuns.id, older!.id));
      await serverDB
        .update(widgetRuns)
        .set({ startedAt: new Date(Date.now() - 60_000) })
        .where(eq(widgetRuns.id, newer!.id));

      await model.finishRun(newer!.id, {
        output: { type: 'stat', value: 2 },
        status: 'succeeded',
      });
      // the slower, older run reports last — it must not overwrite the newer result
      const late = await model.finishRun(older!.id, {
        error: { code: 'NON_ZERO_EXIT', message: 'boom' },
        status: 'failed',
      });
      expect(late).toMatchObject({ id: older!.id, status: 'failed' });

      expect(await model.findById(widget.id)).toMatchObject({
        consecutiveFailures: 0,
        lastRunError: null,
        lastRunId: newer!.id,
        lastRunStatus: 'succeeded',
        latestOutput: { type: 'stat', value: 2 },
      });
      expect(await model.findRun(widget.id, older!.id)).toMatchObject({ status: 'failed' });
    });

    it('does not fold a run of a version that is no longer published', async () => {
      const widget = await model.create({ title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, v1!.id);
      const first = await model.startRun(widget.id, { trigger: 'manual' });
      await model.finishRun(first!.id, { output: { type: 'stat', value: 1 }, status: 'succeeded' });

      const stale = await model.startRun(widget.id, { trigger: 'schedule' });
      // v2 goes live while v1's run is still in flight
      const v2 = await model.createVersion(widget.id, script(2));
      await model.publishVersion(widget.id, v2!.id);

      const finished = await model.finishRun(stale!.id, {
        output: { type: 'stat', value: 99 },
        status: 'succeeded',
      });
      expect(finished).toMatchObject({ id: stale!.id, status: 'succeeded', versionId: v1!.id });
      expect(await model.findById(widget.id)).toMatchObject({
        lastRunId: first!.id,
        latestOutput: { type: 'stat', value: 1 },
      });

      // a run of the live version still folds
      const fresh = await model.startRun(widget.id, { trigger: 'manual' });
      await model.finishRun(fresh!.id, { output: { type: 'stat', value: 2 }, status: 'succeeded' });
      expect(await model.findById(widget.id)).toMatchObject({
        lastRunId: fresh!.id,
        latestOutput: { type: 'stat', value: 2 },
      });
    });

    it('reports whether a finished run folded into the snapshot', async () => {
      const widget = await model.create({ title: 'w' });
      const v1 = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, v1!.id);
      const live = (await model.findById(widget.id))!;
      const done = { output: { type: 'stat' as const, value: 1 }, status: 'succeeded' as const };

      const preview = await WidgetModel.startRun(serverDB, live, { trigger: 'preview' });
      expect(await WidgetModel.finishRun(serverDB, preview.id, done)).toMatchObject({
        folded: false,
        run: { id: preview.id },
      });

      const early = await WidgetModel.startRun(serverDB, live, { trigger: 'schedule' });
      await serverDB
        .update(widgetRuns)
        .set({ startedAt: new Date(Date.now() - 60_000) })
        .where(eq(widgetRuns.id, early.id));
      const current = await WidgetModel.startRun(serverDB, live, { trigger: 'manual' });
      expect(await WidgetModel.finishRun(serverDB, current.id, done)).toMatchObject({
        folded: true,
        run: { id: current.id, status: 'succeeded' },
      });
      // started before the snapshot's run: persisted, not folded
      expect(await WidgetModel.finishRun(serverDB, early.id, done)).toMatchObject({
        folded: false,
        run: { id: early.id, status: 'succeeded' },
      });

      const stale = await WidgetModel.startRun(serverDB, live, { trigger: 'schedule' });
      const v2 = await model.createVersion(widget.id, script(2));
      await model.publishVersion(widget.id, v2!.id);
      expect(await WidgetModel.finishRun(serverDB, stale.id, done)).toMatchObject({
        folded: false,
      });
      expect(await WidgetModel.finishRun(serverDB, stale.id, done)).toBeUndefined();
    });

    it('lets workspace readers run a public widget but not a private one', async () => {
      const pub = await ws.create({ title: 'pub' });
      const priv = await ws.create({ title: 'priv', visibility: 'private' });
      for (const w of [pub, priv]) {
        await ws.publishVersion(w.id, (await ws.createVersion(w.id, script(1)))!.id);
      }

      const run = await member.startRun(pub.id, { trigger: 'manual' });
      // run ownership follows the widget, not the actor
      expect(run).toMatchObject({ userId, workspaceId });
      expect(await member.finishRun(run!.id, { status: 'succeeded' })).toMatchObject({
        status: 'succeeded',
      });

      expect(await member.startRun(priv.id, { trigger: 'manual' })).toBeUndefined();
      const privRun = await ws.startRun(priv.id, { trigger: 'manual' });
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
      expect(await model.startRun(MISSING_UUID, { trigger: 'manual' })).toBeUndefined();
    });
  });

  describe('scheduler', () => {
    it('loads a live widget with its published version and links its metric', async () => {
      const widget = await model.create({ title: 'w' });
      expect(await WidgetModel.findLiveWithPublishedVersion(serverDB, widget.id)).toBeUndefined();

      const v1 = await model.createVersion(widget.id, script(1));
      await model.publishVersion(widget.id, v1!.id);
      const live = await WidgetModel.findLiveWithPublishedVersion(serverDB, widget.id);
      expect(live).toMatchObject({ version: { id: v1!.id }, widget: { id: widget.id } });

      const [metric] = await serverDB
        .insert(metrics)
        .values({ key: 'value', subjectId: widget.id, subjectType: 'widget', userId })
        .returning();
      const [runA, runB] = [
        await WidgetModel.startRun(serverDB, widget, { trigger: 'manual', versionId: v1!.id }),
        await WidgetModel.startRun(serverDB, widget, { trigger: 'manual', versionId: v1!.id }),
      ];
      await serverDB.update(widgets).set({ lastRunId: runA.id }).where(eq(widgets.id, widget.id));
      await WidgetModel.linkMetric(serverDB, widget.id, metric.id, runA.id);
      expect((await model.findById(widget.id))!.metricId).toBe(metric.id);

      // run B took the snapshot; a late link from run A must not move the metric
      const [other] = await serverDB
        .insert(metrics)
        .values({ key: 'series:a', subjectId: widget.id, subjectType: 'widget', userId })
        .returning();
      await serverDB.update(widgets).set({ lastRunId: runB.id }).where(eq(widgets.id, widget.id));
      await WidgetModel.linkMetric(serverDB, widget.id, other.id, runA.id);
      expect((await model.findById(widget.id))!.metricId).toBe(metric.id);

      await model.trash(widget.id);
      expect(await WidgetModel.findLiveWithPublishedVersion(serverDB, widget.id)).toBeUndefined();
    });

    it('finds due widgets across users and claims each slot once', async () => {
      const now = new Date('2030-01-01T01:00:00Z');
      const past = new Date('2030-01-01T00:00:00Z');
      const future = new Date('2030-01-01T02:00:00Z');

      const make = async (
        m: WidgetModel,
        title: string,
        opts: { nextRunAt?: Date | null; publish?: boolean; schedule?: string | null },
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

      const found = await WidgetModel.findDue(serverDB, { now });
      expect(found.map((r) => r.widget.id)).toEqual([due.id, otherDue.id]);
      expect(found[0].version.id).toBe(found[0].widget.publishedVersionId);
      expect(await WidgetModel.findDue(serverDB, { limit: 1, now })).toHaveLength(1);

      // two ticks racing for the same slot: exactly one wins and reserves the run
      const claim = {
        expectedNextRunAt: past,
        nextRunAt: future,
        versionId: found[0].version.id,
        widgetId: due.id,
      };
      const results = await Promise.all([
        WidgetModel.claimDueRun(serverDB, claim),
        WidgetModel.claimDueRun(serverDB, claim),
      ]);
      const reserved = results.filter(Boolean);
      expect(reserved).toHaveLength(1);
      expect(reserved[0]).toMatchObject({
        finishedAt: null,
        status: 'running',
        trigger: 'schedule',
        userId,
        versionId: found[0].version.id,
        widgetId: due.id,
      });
      expect(await WidgetModel.claimDueRun(serverDB, claim)).toBeUndefined();

      const remaining = await WidgetModel.findDue(serverDB, { now });
      expect(remaining.map((r) => r.widget.id)).toEqual([otherDue.id]);

      const [row] = await serverDB.select().from(widgets).where(eq(widgets.id, due.id));
      expect(row.nextRunAt).toEqual(future);
      expect(await serverDB.select().from(widgetRuns)).toMatchObject([{ id: reserved[0]!.id }]);
    });

    describe('reservations', () => {
      const past = new Date('2030-01-01T00:00:00Z');
      const future = new Date('2030-01-01T02:00:00Z');

      const dueWidget = async (m = model) => {
        const w = await m.create({ schedulePattern: '0 * * * *', title: 'scheduled' });
        const v = await m.createVersion(w.id, script(1));
        await m.publishVersion(w.id, v!.id);
        await m.update(w.id, { nextRunAt: past });
        return { version: v!, widget: w };
      };
      const reserve = async ({ version, widget }: Awaited<ReturnType<typeof dueWidget>>) =>
        (await WidgetModel.claimDueRun(serverDB, {
          expectedNextRunAt: past,
          nextRunAt: future,
          versionId: version.id,
          widgetId: widget.id,
        }))!;
      const backdate = (runId: string, ms: number) =>
        serverDB
          .update(widgetRuns)
          .set({ startedAt: new Date(Date.now() - ms) })
          .where(eq(widgetRuns.id, runId));
      const staleOptions = (extra = {}) => ({
        createdAfter: new Date(Date.now() - 60 * 60_000),
        limit: 10,
        startedBefore: new Date(Date.now() - 5 * 60_000),
        ...extra,
      });

      it('leaves the slot due and reserves nothing when the reservation fails', async () => {
        const target = await dueWidget();
        const transaction = serverDB.transaction.bind(serverDB);
        vi.spyOn(serverDB, 'transaction').mockImplementationOnce(((
          fn: Parameters<typeof transaction>[0],
        ) =>
          transaction(async (tx) => {
            vi.spyOn(tx, 'insert').mockImplementation(() => {
              throw new Error('insert failed');
            });
            return fn(tx);
          })) as typeof serverDB.transaction);

        await expect(
          WidgetModel.claimDueRun(serverDB, {
            expectedNextRunAt: past,
            nextRunAt: future,
            versionId: target.version.id,
            widgetId: target.widget.id,
          }),
        ).rejects.toThrow('insert failed');
        vi.restoreAllMocks();

        const [row] = await serverDB.select().from(widgets).where(eq(widgets.id, target.widget.id));
        expect(row.nextRunAt).toEqual(past);
        expect(await serverDB.select().from(widgetRuns)).toHaveLength(0);
        // the slot is still claimable afterwards
        expect(await reserve(target)).toMatchObject({ status: 'running' });
      });

      it('finds reservations started before the cut, only for live scheduled widgets', async () => {
        const a = await dueWidget();
        const fresh = await dueWidget();
        const trashed = await dueWidget();
        const unscheduled = await dueWidget();
        const runA = await reserve(a);
        await reserve(fresh);
        const runTrashed = await reserve(trashed);
        const runUnscheduled = await reserve(unscheduled);
        for (const id of [runA.id, runTrashed.id, runUnscheduled.id])
          await backdate(id, 10 * 60_000);
        await model.trash(trashed.widget.id);
        await model.update(unscheduled.widget.id, { schedulePattern: null });

        // a manual run left running is not a reservation
        const manual = await model.startRun(a.widget.id, { trigger: 'manual' });
        await backdate(manual!.id, 10 * 60_000);

        const found = await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions());
        expect(found.map((r) => r.run.id)).toEqual([runA.id]);
        expect(found[0]).toMatchObject({
          version: { id: a.version.id },
          widget: { id: a.widget.id },
        });
        expect(
          await WidgetModel.findStaleScheduledRuns(
            serverDB,
            staleOptions({ widgetId: a.widget.id }),
          ),
        ).toHaveLength(1);
        expect(
          await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions({ runId: MISSING_UUID })),
        ).toEqual([]);
        expect(
          await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions({ runId: 'nope' })),
        ).toEqual([]);
        // older than the recovery horizon: no longer resumed
        expect(
          await WidgetModel.findStaleScheduledRuns(
            serverDB,
            staleOptions({ createdAfter: new Date(Date.now() + 60_000) }),
          ),
        ).toEqual([]);

        // once finished it is no longer a candidate
        await WidgetModel.finishRun(serverDB, runA.id, { status: 'failed' });
        expect(await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions())).toEqual([]);
      });

      it('renews a lease once per observed start, only while the run is running', async () => {
        const run = await reserve(await dueWidget());
        await backdate(run.id, 10 * 60_000);
        const [stale] = await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions());

        const renew = () =>
          WidgetModel.renewRunLease(serverDB, {
            expectedStartedAt: stale.run.startedAt,
            runId: run.id,
          });
        const [first, second] = await Promise.all([renew(), renew()]);
        const won = [first, second].filter(Boolean);
        expect(won).toHaveLength(1);
        expect(won[0]!.startedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
        // the renewed run is within its lease again
        expect(await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions())).toEqual([]);

        // a run created by `startRun` carries microseconds; the lease still compares
        await backdate(run.id, 10 * 60_000);
        await serverDB
          .update(widgetRuns)
          .set({ startedAt: sql`now() - interval '10 minutes 0.000123 seconds'` })
          .where(eq(widgetRuns.id, run.id));
        const [again] = await WidgetModel.findStaleScheduledRuns(serverDB, staleOptions());
        expect(
          await WidgetModel.renewRunLease(serverDB, {
            expectedStartedAt: again.run.startedAt,
            runId: run.id,
          }),
        ).toMatchObject({ id: run.id, status: 'running' });

        await WidgetModel.finishRun(serverDB, run.id, { status: 'failed' });
        expect(
          await WidgetModel.renewRunLease(serverDB, {
            expectedStartedAt: (await model.findRun(stale.widget.id, run.id))!.startedAt,
            runId: run.id,
          }),
        ).toBeUndefined();
        expect(
          await WidgetModel.renewRunLease(serverDB, { expectedStartedAt: new Date(), runId: 'x' }),
        ).toBeUndefined();
      });
    });

    it('skips due widgets whose project or agent is trashed or private to someone else', async () => {
      const now = new Date('2030-01-01T01:00:00Z');
      const past = new Date('2030-01-01T00:00:00Z');
      await seedProject('wgt-due-trash');
      await serverDB.insert(agents).values({ id: 'wgt-due-agent', userId, workspaceId });
      await seedProject('wgt-due-teammate', { owner: otherUserId });
      await seedProject('wgt-due-own-private');

      const make = async (title: string, scope: { agentId?: string; projectId?: string }) => {
        const w = await ws.create({ ...scope, schedulePattern: '0 * * * *', title });
        const v = await ws.createVersion(w.id, script(title.length));
        await ws.publishVersion(w.id, v!.id);
        await ws.update(w.id, { nextRunAt: past });
        return w;
      };
      const inTrashedProject = await make('trashed-project', { projectId: 'wgt-due-trash' });
      const inTrashedAgent = await make('trashed-agent', { agentId: 'wgt-due-agent' });
      const inTeammateProject = await make('teammate', { projectId: 'wgt-due-teammate' });
      const inOwnPrivate = await make('own-private', { projectId: 'wgt-due-own-private' });

      const trashStampValue = { deletedAt: now, isDeleted: true };
      await serverDB.update(projects).set(trashStampValue).where(eq(projects.id, 'wgt-due-trash'));
      await serverDB.update(agents).set(trashStampValue).where(eq(agents.id, 'wgt-due-agent'));
      await serverDB
        .update(projects)
        .set({ visibility: 'private' })
        .where(inArray(projects.id, ['wgt-due-teammate', 'wgt-due-own-private']));

      const dueIds = async () =>
        (await WidgetModel.findDue(serverDB, { now })).map((r) => r.widget.id).sort();

      // a private parent the widget's owner created does not block it
      expect(await dueIds()).toEqual([inOwnPrivate.id]);
      // nor can an already-dispatched slot load them for execution
      for (const w of [inTrashedProject, inTrashedAgent, inTeammateProject]) {
        expect(await WidgetModel.findLiveWithPublishedVersion(serverDB, w.id)).toBeUndefined();
      }
      expect(
        await WidgetModel.findLiveWithPublishedVersion(serverDB, inOwnPrivate.id),
      ).toBeDefined();
      // skipped widgets keep their slot
      const rows = await serverDB
        .select()
        .from(widgets)
        .where(inArray(widgets.id, [inTrashedProject.id, inTrashedAgent.id, inTeammateProject.id]));
      expect(rows.map((r) => r.nextRunAt)).toEqual([past, past, past]);

      // restore the trashed parents and make the teammate's project public again
      const restored = { deletedAt: null, isDeleted: null };
      await serverDB.update(projects).set(restored).where(eq(projects.id, 'wgt-due-trash'));
      await serverDB.update(agents).set(restored).where(eq(agents.id, 'wgt-due-agent'));
      await serverDB
        .update(projects)
        .set({ visibility: 'public' })
        .where(eq(projects.id, 'wgt-due-teammate'));

      expect(await dueIds()).toEqual(
        [inTrashedProject.id, inTrashedAgent.id, inTeammateProject.id, inOwnPrivate.id].sort(),
      );
    });
  });
});
