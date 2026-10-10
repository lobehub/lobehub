// @vitest-environment node
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  dashboardItems,
  dashboards,
  projects,
  trashItems,
  users,
  widgets as widgetsTable,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ScopeLevelError } from '../../utils/scopeLevel';
import { DASHBOARD_MAX_ITEMS, DashboardItemLimitError, DashboardModel } from '../dashboard';
import { WidgetModel } from '../widget';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'dashboard-model-user';
const otherUserId = 'dashboard-model-other-user';
const workspaceId = 'dashboard-model-ws';
const otherWorkspaceId = 'dashboard-model-ws-2';

const seedAgent = async (id: string, owner: string, ws: string | null) => {
  await serverDB.insert(agents).values({ id, userId: owner, workspaceId: ws });
  return id;
};

let identifierSeq = 0;
const seedProject = async (
  id: string,
  owner: string,
  ws: string | null,
  visibility: 'private' | 'public' = 'public',
) => {
  const coordinatorAgentId = await seedAgent(`${id}-coordinator`, owner, ws);
  await serverDB.insert(projects).values({
    coordinatorAgentId,
    id,
    identifier: `D${String(++identifierSeq).padStart(4, '0')}`,
    name: id,
    userId: owner,
    visibility,
    workspaceId: ws,
  });
  return id;
};

beforeEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 'dashboard-ws' },
    { id: otherWorkspaceId, name: 'WS2', primaryOwnerId: userId, slug: 'dashboard-ws-2' },
  ]);
});

afterEach(async () => {
  await serverDB.delete(trashItems);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
});

describe('DashboardModel', () => {
  describe('create / find / update', () => {
    it('creates a personal dashboard with uuid id and null scope columns', async () => {
      const model = new DashboardModel(serverDB, userId);
      const dashboard = await model.create({ title: 'Home' });

      expect(dashboard.id).toMatch(/^[\da-f-]{36}$/);
      expect(dashboard).toMatchObject({
        agentId: null,
        projectId: null,
        title: 'Home',
        userId,
        visibility: 'public',
        workspaceId: null,
      });
      expect(await model.findById(dashboard.id)).toMatchObject({ id: dashboard.id });
    });

    it('updates only the creator’s dashboard', async () => {
      const model = new DashboardModel(serverDB, userId);
      const dashboard = await model.create({ title: 'Home' });

      const other = new DashboardModel(serverDB, otherUserId);
      expect(await other.update(dashboard.id, { title: 'hacked' })).toBeUndefined();
      expect(await other.findById(dashboard.id)).toBeUndefined();

      const updated = await model.update(dashboard.id, { icon: '📈', title: 'Ops' });
      expect(updated).toMatchObject({ icon: '📈', title: 'Ops' });
    });

    it('lets workspace members read public boards but not private ones or edit either', async () => {
      const owner = new DashboardModel(serverDB, userId, workspaceId);
      const member = new DashboardModel(serverDB, otherUserId, workspaceId);

      const pub = await owner.create({ title: 'Team' });
      const priv = await owner.create({ title: 'Mine', visibility: 'private' });

      expect(await member.findById(pub.id)).toMatchObject({ id: pub.id });
      expect(await member.findById(priv.id)).toBeUndefined();
      expect(await member.update(pub.id, { title: 'x' })).toBeUndefined();
    });
  });

  describe('scope consistency', () => {
    it('accepts a project and agent from the same workspace, together', async () => {
      const projectId = await seedProject('dash-p1', userId, workspaceId);
      const agentId = await seedAgent('dash-a1', userId, workspaceId);
      const model = new DashboardModel(serverDB, userId, workspaceId);

      const dashboard = await model.create({ agentId, projectId, title: 'Agent in project' });
      expect(dashboard).toMatchObject({ agentId, projectId, workspaceId });
    });

    it('rejects a project from another workspace', async () => {
      const projectId = await seedProject('dash-p2', userId, otherWorkspaceId);
      const model = new DashboardModel(serverDB, userId, workspaceId);

      await expect(model.create({ projectId, title: 'x' })).rejects.toMatchObject({
        code: 'SCOPE_MISMATCH',
      });
    });

    it('rejects a personal agent when creating a workspace dashboard', async () => {
      const agentId = await seedAgent('dash-a2', userId, null);
      const model = new DashboardModel(serverDB, userId, workspaceId);

      await expect(model.create({ agentId, title: 'x' })).rejects.toBeInstanceOf(ScopeLevelError);
    });

    it('rejects a workspace project when creating a personal dashboard', async () => {
      const projectId = await seedProject('dash-p3', userId, workspaceId);
      const model = new DashboardModel(serverDB, userId);

      await expect(model.create({ projectId, title: 'x' })).rejects.toMatchObject({
        code: 'SCOPE_MISMATCH',
      });
    });

    it('rejects another user’s personal project and unknown ids as not found', async () => {
      const projectId = await seedProject('dash-p4', otherUserId, null);
      const model = new DashboardModel(serverDB, userId);

      await expect(model.create({ projectId, title: 'x' })).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      await expect(model.create({ agentId: 'missing', title: 'x' })).rejects.toMatchObject({
        code: 'AGENT_NOT_FOUND',
      });
    });
  });

  describe('list by direct level', () => {
    it('returns only rows living directly on the requested level', async () => {
      const projectId = await seedProject('dash-p5', userId, workspaceId);
      const agentId = await seedAgent('dash-a5', userId, workspaceId);
      const ws = new DashboardModel(serverDB, userId, workspaceId);
      const personal = new DashboardModel(serverDB, userId);

      const mine = await personal.create({ title: 'personal' });
      const wsBoard = await ws.create({ sortOrder: 1, title: 'workspace' });
      const wsBoard2 = await ws.create({ sortOrder: 0, title: 'workspace-2' });
      const projectBoard = await ws.create({ projectId, title: 'project' });
      const agentBoard = await ws.create({ agentId, title: 'agent' });
      const agentInProject = await ws.create({ agentId, projectId, title: 'agent-in-project' });

      expect((await personal.list()).map((d) => d.id)).toEqual([mine.id]);
      expect((await ws.list()).map((d) => d.id)).toEqual([wsBoard2.id, wsBoard.id]);
      expect((await ws.list({ projectId })).map((d) => d.id)).toEqual([projectBoard.id]);
      expect((await ws.list({ agentId })).map((d) => d.id)).toEqual([agentBoard.id]);
      expect((await ws.list({ agentId, projectId })).map((d) => d.id)).toEqual([agentInProject.id]);
    });

    it('lists every board of a project, with or without an agent, via listByProject', async () => {
      const projectId = await seedProject('dash-p7', userId, workspaceId);
      const otherProjectId = await seedProject('dash-p8', userId, workspaceId);
      const agentId = await seedAgent('dash-a7', userId, workspaceId);
      const ws = new DashboardModel(serverDB, userId, workspaceId);
      const outsider = new DashboardModel(serverDB, otherUserId, workspaceId);

      await ws.create({ title: 'workspace' });
      await ws.create({ agentId, title: 'agent only' });
      await ws.create({ projectId: otherProjectId, title: 'other project' });
      const projectBoard = await ws.create({ projectId, sortOrder: 1, title: 'project' });
      const agentInProject = await ws.create({
        agentId,
        projectId,
        sortOrder: 0,
        title: 'agent-in-project',
      });
      const privateBoard = await ws.create({
        projectId,
        sortOrder: 2,
        title: 'private',
        visibility: 'private',
      });
      await ws.trash((await ws.create({ projectId, title: 'trashed' })).id);

      expect((await ws.listByProject(projectId)).map((d) => d.id)).toEqual([
        agentInProject.id,
        projectBoard.id,
        privateBoard.id,
      ]);
      // workspace members only see the public ones
      expect((await outsider.listByProject(projectId)).map((d) => d.id)).not.toContain(
        privateBoard.id,
      );
    });

    it('cascades dashboards when their project or agent is deleted', async () => {
      const projectId = await seedProject('dash-p6', userId, null);
      const agentId = await seedAgent('dash-a6', userId, null);
      const model = new DashboardModel(serverDB, userId);
      const p = await model.create({ projectId, title: 'p' });
      const a = await model.create({ agentId, title: 'a' });

      await serverDB.delete(projects).where(eq(projects.id, projectId));
      await serverDB.delete(agents).where(eq(agents.id, agentId));

      const rows = await serverDB.select().from(dashboards);
      expect(rows.map((r) => r.id)).not.toContain(p.id);
      expect(rows.map((r) => r.id)).not.toContain(a.id);
    });
  });

  describe('recycle bin', () => {
    it('purge deletes only a board that is still trashed', async () => {
      const model = new DashboardModel(serverDB, userId, workspaceId);
      const dashboard = await model.create({ title: 'Ops' });
      await model.trash(dashboard.id);
      // a restore commits before the purge reaches the row
      await model.restore(dashboard.id);

      expect(await model.purge(dashboard.id)).toBeUndefined();
      expect(await model.findById(dashboard.id)).toMatchObject({ id: dashboard.id });

      await model.trash(dashboard.id);
      expect(await model.purge(dashboard.id)).toMatchObject({ id: dashboard.id });
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.resourceId, dashboard.id)),
      ).toHaveLength(0);
    });

    it('trash hides the board and registers it; restore brings it back', async () => {
      const model = new DashboardModel(serverDB, userId, workspaceId);
      const dashboard = await model.create({ title: 'Ops' });

      expect(
        await new DashboardModel(serverDB, otherUserId, workspaceId).trash(dashboard.id),
      ).toBeUndefined();

      const trashed = await model.trash(dashboard.id);
      expect(trashed).toMatchObject({ isDeleted: true });
      expect(trashed?.deletedAt).toBeInstanceOf(Date);
      expect(await model.findById(dashboard.id)).toBeUndefined();
      expect(await model.list()).toEqual([]);

      const [entry] = await serverDB
        .select()
        .from(trashItems)
        .where(eq(trashItems.resourceId, dashboard.id));
      expect(entry).toMatchObject({
        deletedByUserId: userId,
        resourceType: 'dashboard',
        rootId: null,
        title: 'Ops',
        workspaceId,
      });
      expect(entry.expiresAt.getTime()).toBeGreaterThan(entry.deletedAt.getTime());

      // trashing twice is a no-op
      expect(await model.trash(dashboard.id)).toBeUndefined();

      const restored = await model.restore(dashboard.id);
      expect(restored).toMatchObject({ deletedAt: null, isDeleted: null });
      expect(await model.findById(dashboard.id)).toMatchObject({ id: dashboard.id });
      expect(
        await serverDB.select().from(trashItems).where(eq(trashItems.resourceId, dashboard.id)),
      ).toHaveLength(0);
      expect(await model.restore(dashboard.id)).toBeUndefined();
    });

    it('hard delete removes a trashed board and its registry entry', async () => {
      const model = new DashboardModel(serverDB, userId);
      const dashboard = await model.create({ title: 'tmp' });
      await model.trash(dashboard.id);

      expect(await new DashboardModel(serverDB, otherUserId).delete(dashboard.id)).toBeUndefined();
      expect(await model.delete(dashboard.id)).toMatchObject({ id: dashboard.id });
      expect(
        await serverDB.select().from(dashboards).where(eq(dashboards.id, dashboard.id)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(trashItems)).toHaveLength(0);
      expect(await model.delete(dashboard.id)).toBeUndefined();
    });
  });

  describe('items', () => {
    it('adds widgets with increasing sort order, upserts placement, lists and removes', async () => {
      const model = new DashboardModel(serverDB, userId);
      const widgets = new WidgetModel(serverDB, userId);
      const dashboard = await model.create({ title: 'Home' });
      const w1 = await widgets.create({ title: 'PRs' });
      const w2 = await widgets.create({ title: 'Stars' });

      const i1 = await model.addItem(dashboard.id, w1.id, { layout: { h: 2, w: 4, x: 0, y: 0 } });
      const i2 = await model.addItem(dashboard.id, w2.id);
      expect(i1).toMatchObject({ sortOrder: 0, userId, workspaceId: null });
      expect(i2).toMatchObject({ layout: null, sortOrder: 1 });

      // re-adding updates the existing placement instead of duplicating
      const again = await model.addItem(dashboard.id, w1.id, {
        layout: { h: 3, w: 6, x: 0, y: 0 },
      });
      expect(again?.id).toBe(i1?.id);
      expect(again?.layout).toEqual({ h: 3, w: 6, x: 0, y: 0 });

      const listed = await model.listItems(dashboard.id);
      expect(listed.map((r) => r.widget.title)).toEqual(['PRs', 'Stars']);

      expect(
        await model.updateItemLayouts(dashboard.id, [
          { id: i1!.id, sortOrder: 5 },
          { id: i2!.id, layout: { h: 1, w: 2, x: 4, y: 0 }, sortOrder: 0 },
          { id: '00000000-0000-0000-0000-000000000000', sortOrder: 9 },
        ]),
      ).toBe(2);
      expect((await model.listItems(dashboard.id)).map((r) => r.widget.title)).toEqual([
        'Stars',
        'PRs',
      ]);
      expect(await model.updateItemLayouts(dashboard.id, [])).toBe(0);

      // trashed widgets drop out of the board without losing the placement
      await widgets.trash(w2.id);
      expect((await model.listItems(dashboard.id)).map((r) => r.widget.id)).toEqual([w1.id]);
      await widgets.restore(w2.id);

      expect(await model.removeItems(dashboard.id, [i2!.id])).toBe(1);
      expect(await model.removeItems(dashboard.id, [])).toBe(0);
      expect((await model.listItems(dashboard.id)).map((r) => r.widget.id)).toEqual([w1.id]);
    });

    it('refuses a new widget on a full board but still updates placed ones', async () => {
      const model = new DashboardModel(serverDB, userId);
      const dashboard = await model.create({ title: 'Full' });
      const seeded = await serverDB
        .insert(widgetsTable)
        .values(
          Array.from({ length: DASHBOARD_MAX_ITEMS + 1 }, (_, i) => ({ title: `w${i}`, userId })),
        )
        .returning({ id: widgetsTable.id });
      const [extra, ...placed] = seeded;
      await serverDB.insert(dashboardItems).values(
        placed.map(({ id }, sortOrder) => ({
          dashboardId: dashboard.id,
          sortOrder,
          userId,
          widgetId: id,
        })),
      );

      await expect(model.addItem(dashboard.id, extra.id)).rejects.toBeInstanceOf(
        DashboardItemLimitError,
      );
      const moved = await model.addItem(dashboard.id, placed[0].id, { sortOrder: 999 });
      expect(moved?.sortOrder).toBe(999);
    });

    it('refuses items on boards or widgets the caller cannot manage or see', async () => {
      const model = new DashboardModel(serverDB, userId);
      const other = new DashboardModel(serverDB, otherUserId);
      const dashboard = await model.create({ title: 'Home' });
      const myWidget = await new WidgetModel(serverDB, userId).create({ title: 'mine' });
      const theirWidget = await new WidgetModel(serverDB, otherUserId).create({
        title: 'theirs',
      });

      expect(await other.addItem(dashboard.id, myWidget.id)).toBeUndefined();
      expect(await model.addItem(dashboard.id, theirWidget.id)).toBeUndefined();
      expect(await other.listItems(dashboard.id)).toEqual([]);

      const item = await model.addItem(dashboard.id, myWidget.id);
      expect(await other.updateItemLayouts(dashboard.id, [{ id: item!.id, sortOrder: 3 }])).toBe(0);
      expect(await other.removeItems(dashboard.id, [item!.id])).toBe(0);
      expect(
        await serverDB
          .select()
          .from(dashboardItems)
          .where(and(eq(dashboardItems.id, item!.id), eq(dashboardItems.sortOrder, 0))),
      ).toHaveLength(1);
    });

    it('lists items of many readable boards at once, with the same rules as listItems', async () => {
      const model = new DashboardModel(serverDB, userId);
      const widgetModel = new WidgetModel(serverDB, userId);
      const first = await model.create({ title: 'First' });
      const second = await model.create({ title: 'Second' });
      const trashedBoard = await model.create({ title: 'Trashed' });
      const theirs = await new DashboardModel(serverDB, otherUserId).create({ title: 'Theirs' });
      const a = await widgetModel.create({ title: 'a' });
      const b = await widgetModel.create({ title: 'b' });
      const gone = await widgetModel.create({ title: 'gone' });
      await model.addItem(first.id, b.id);
      await model.addItem(first.id, a.id);
      await model.addItem(first.id, gone.id);
      await model.addItem(second.id, a.id);
      await model.addItem(trashedBoard.id, a.id);
      await widgetModel.trash(gone.id);
      await model.trash(trashedBoard.id);

      const rows = await model.listItemsForDashboards([
        first.id,
        second.id,
        trashedBoard.id,
        theirs.id,
        'not-a-uuid',
      ]);
      const byBoard = (id: string) =>
        rows.filter((r) => r.item.dashboardId === id).map((r) => r.widget.title);
      for (const board of [first, second]) {
        expect(byBoard(board.id)).toEqual(
          (await model.listItems(board.id)).map((r) => r.widget.title),
        );
      }
      expect(byBoard(first.id)).toEqual(['b', 'a']);
      expect(byBoard(second.id)).toEqual(['a']);
      expect(rows).toHaveLength(3);
      expect(await model.listItemsForDashboards([])).toEqual([]);
      expect(
        await new DashboardModel(serverDB, otherUserId).listItemsForDashboards([first.id]),
      ).toEqual([]);
    });

    it('lists the readable, live boards a widget is placed on', async () => {
      const model = new DashboardModel(serverDB, userId);
      const widget = await new WidgetModel(serverDB, userId).create({ title: 'w' });
      const first = await model.create({ sortOrder: 0, title: 'First' });
      const second = await model.create({ sortOrder: 1, title: 'Second' });
      const trashed = await model.create({ sortOrder: 2, title: 'Trashed' });
      await model.create({ title: 'Unrelated' });
      for (const board of [second, first, trashed]) await model.addItem(board.id, widget.id);
      await model.trash(trashed.id);

      expect(await model.listByWidget(widget.id)).toEqual([
        { id: first.id, projectId: null, title: 'First' },
        { id: second.id, projectId: null, title: 'Second' },
      ]);
      // another user sees none of this user's boards
      expect(await new DashboardModel(serverDB, otherUserId).listByWidget(widget.id)).toEqual([]);
    });

    it('removes placements when the board is hard deleted', async () => {
      const model = new DashboardModel(serverDB, userId);
      const dashboard = await model.create({ title: 'Home' });
      const widget = await new WidgetModel(serverDB, userId).create({ title: 'w' });
      await model.addItem(dashboard.id, widget.id);

      await model.delete(dashboard.id);
      expect(await serverDB.select().from(dashboardItems)).toHaveLength(0);
    });
  });
  describe('parent visibility', () => {
    it('forces private boards under a private project and refuses to widen them', async () => {
      const privateProject = await seedProject('dash-priv', userId, workspaceId, 'private');
      const owner = new DashboardModel(serverDB, userId, workspaceId);

      const board = await owner.create({
        projectId: privateProject,
        title: 'secret',
        visibility: 'public',
      });
      expect(board.visibility).toBe('private');
      expect((await owner.update(board.id, { visibility: 'public' }))?.visibility).toBe('private');
    });

    it('hides a public board once its project or agent turns private', async () => {
      const projectId = await seedProject('dash-flip', userId, workspaceId);
      const agentId = await seedAgent('dash-flip-agent', userId, workspaceId);
      const owner = new DashboardModel(serverDB, userId, workspaceId);
      const member = new DashboardModel(serverDB, otherUserId, workspaceId);
      const inProject = await owner.create({ projectId, title: 'p' });
      const inAgent = await owner.create({ agentId, title: 'a' });
      const widget = await new WidgetModel(serverDB, userId, workspaceId).create({ title: 'w' });
      await owner.addItem(inProject.id, widget.id);
      expect((await member.findById(inProject.id))?.id).toBe(inProject.id);

      await serverDB
        .update(projects)
        .set({ visibility: 'private' })
        .where(eq(projects.id, projectId));
      await serverDB.update(agents).set({ visibility: 'private' }).where(eq(agents.id, agentId));

      expect(await member.findById(inProject.id)).toBeUndefined();
      expect(await member.findById(inAgent.id)).toBeUndefined();
      expect(await member.list({ projectId })).toEqual([]);
      expect(await member.listByProject(projectId)).toEqual([]);
      expect(await member.listItems(inProject.id)).toEqual([]);
      expect(await member.listByWidget(widget.id)).toEqual([]);
      // the parents' creator still sees them
      expect((await owner.listByProject(projectId)).map((d) => d.id)).toEqual([inProject.id]);
    });

    it('hides boards and widget items while their project or agent is trashed', async () => {
      const personalProject = await seedProject('dash-bin', userId, null);
      const personalAgent = await seedAgent('dash-bin-agent', userId, null);
      const wsProject = await seedProject('dash-bin-ws', userId, workspaceId);
      const setTrashed = async (trashed: boolean) => {
        const stamp = trashed
          ? { deletedAt: new Date(), isDeleted: true }
          : { deletedAt: null, isDeleted: null };
        await serverDB.update(projects).set(stamp).where(eq(projects.id, personalProject));
        await serverDB.update(projects).set(stamp).where(eq(projects.id, wsProject));
        await serverDB.update(agents).set(stamp).where(eq(agents.id, personalAgent));
      };

      // personal mode
      const personal = new DashboardModel(serverDB, userId);
      const inProject = await personal.create({ projectId: personalProject, title: 'p' });
      const inAgent = await personal.create({ agentId: personalAgent, title: 'a' });
      const home = await personal.create({ title: 'home' });
      const widgetModel = new WidgetModel(serverDB, userId);
      const projectWidget = await widgetModel.create({ projectId: personalProject, title: 'pw' });
      const looseWidget = await widgetModel.create({ title: 'loose' });
      await personal.addItem(home.id, projectWidget.id);
      await personal.addItem(home.id, looseWidget.id);
      await personal.addItem(inProject.id, looseWidget.id);

      // workspace mode, public project read by a teammate
      const owner = new DashboardModel(serverDB, userId, workspaceId);
      const member = new DashboardModel(serverDB, otherUserId, workspaceId);
      const wsBoard = await owner.create({ projectId: wsProject, title: 'team' });

      await setTrashed(true);

      expect(await personal.findById(inProject.id)).toBeUndefined();
      expect(await personal.findById(inAgent.id)).toBeUndefined();
      expect(await personal.list({ projectId: personalProject })).toEqual([]);
      expect(await personal.list({ agentId: personalAgent })).toEqual([]);
      expect(await personal.listByProject(personalProject)).toEqual([]);
      expect(await personal.listItems(inProject.id)).toEqual([]);
      // a live board drops the widget of the trashed project
      expect((await personal.listItems(home.id)).map((r) => r.widget.title)).toEqual(['loose']);
      expect((await personal.listByWidget(looseWidget.id)).map((d) => d.id)).toEqual([home.id]);
      for (const reader of [owner, member]) {
        expect(await reader.findById(wsBoard.id)).toBeUndefined();
        expect(await reader.listByProject(wsProject)).toEqual([]);
      }

      // restoring the parents brings everything back
      await setTrashed(false);

      expect((await personal.findById(inProject.id))?.id).toBe(inProject.id);
      expect((await personal.findById(inAgent.id))?.id).toBe(inAgent.id);
      expect((await personal.listItems(home.id)).map((r) => r.widget.title)).toEqual([
        'pw',
        'loose',
      ]);
      expect((await member.listByProject(wsProject)).map((d) => d.id)).toEqual([wsBoard.id]);
    });

    it('drops widgets the reader cannot see from a public board', async () => {
      const projectId = await seedProject('dash-items', userId, workspaceId);
      const owner = new DashboardModel(serverDB, userId, workspaceId);
      const member = new DashboardModel(serverDB, otherUserId, workspaceId);
      const widgetModel = new WidgetModel(serverDB, userId, workspaceId);
      const board = await owner.create({ title: 'team' });

      const open = await widgetModel.create({ title: 'open' });
      const mine = await widgetModel.create({ title: 'mine', visibility: 'private' });
      const inProject = await widgetModel.create({ projectId, title: 'project' });
      for (const w of [open, mine, inProject]) await owner.addItem(board.id, w.id);
      await serverDB
        .update(projects)
        .set({ visibility: 'private' })
        .where(eq(projects.id, projectId));

      expect((await owner.listItems(board.id)).map((r) => r.widget.title)).toEqual([
        'open',
        'mine',
        'project',
      ]);
      expect((await member.listItems(board.id)).map((r) => r.widget.title)).toEqual(['open']);
    });
  });
});
