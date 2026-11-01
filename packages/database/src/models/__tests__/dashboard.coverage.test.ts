// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { dashboardItems, dashboards, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DashboardModel } from '../dashboard';
import { WidgetModel } from '../widget';
import { createProxyTestDB } from './_proxyTestDB';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'dashcov-user';
const notUuid = 'not-a-uuid';

const cleanup = async () => {
  // dashboards, dashboard_items and widgets all cascade from the owning user.
  await serverDB.delete(users).where(eq(users.id, userId));
};

describe('DashboardModel coverage edges', () => {
  beforeEach(async () => {
    await cleanup();
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('short-circuits every id-taking method on a non-UUID id without touching rows', async () => {
    const model = new DashboardModel(serverDB, userId);
    const board = await model.create({ title: 'board' });
    const widget = await new WidgetModel(serverDB, userId).create({ title: 'w' });

    expect(await model.findById(notUuid)).toBeUndefined();
    expect(await model.update(notUuid, { title: 'renamed' })).toBeUndefined();
    expect(await model.trash(notUuid)).toBeUndefined();
    expect(await model.restore(notUuid)).toBeUndefined();
    expect(await model.delete(notUuid)).toBeUndefined();
    expect(await model.purge(notUuid)).toBeUndefined();
    expect(await model.addItem(notUuid, widget.id)).toBeUndefined();
    expect(await model.addItem(board.id, notUuid)).toBeUndefined();
    expect(await model.listByWidget(notUuid)).toEqual([]);

    // A valid item id but a malformed board id: the manage check refuses it.
    const item = await model.addItem(board.id, widget.id, { sortOrder: 3 });
    expect(await model.updateItemLayouts(notUuid, [{ id: item!.id, sortOrder: 9 }])).toBe(0);
    expect(await model.removeItems(notUuid, [item!.id])).toBe(0);

    const [boardRow] = await serverDB.select().from(dashboards).where(eq(dashboards.id, board.id));
    expect(boardRow.title).toBe('board');
    expect(boardRow.isDeleted).not.toBe(true);
    const items = await serverDB
      .select()
      .from(dashboardItems)
      .where(eq(dashboardItems.dashboardId, board.id));
    expect(items).toEqual([expect.objectContaining({ id: item!.id, sortOrder: 3 })]);
  });

  it('keeps a public visibility request when the board has no private parent', async () => {
    const model = new DashboardModel(serverDB, userId);
    const board = await model.create({ title: 'free board', visibility: 'private' });

    const updated = await model.update(board.id, { visibility: 'public' });

    expect(updated).toMatchObject({ id: board.id, visibility: 'public' });
  });

  it('treats a count aggregate that returns no row as an empty board', async () => {
    const model = new DashboardModel(serverDB, userId);
    const board = await model.create({ title: 'board' });
    const widget = await new WidgetModel(serverDB, userId).create({ title: 'w' });

    let countQueries = 0;
    const proxyDB = createProxyTestDB(serverDB, (query, result) => {
      if (/count\(\*\)/i.test(query) && query.includes('"dashboard_items"')) {
        countQueries += 1;
        return [];
      }
      return result.rows;
    });

    const item = await new DashboardModel(proxyDB, userId).addItem(board.id, widget.id);

    expect(countQueries).toBe(1);
    expect(item).toMatchObject({ dashboardId: board.id, sortOrder: 0, widgetId: widget.id });
  });
});
