// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/dashboards` over real HTTP: real routes behind the `app.ts` auth
 * and workspace middlewares, real scope gates, controller, REST service and
 * the shared `dashboard` / `widget` tRPC procedures, on PGlite. Only the
 * database handle and the `dashboard` feature flag are replaced.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ dashboardEnabled: true, serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/services/widget/featureGate', () => ({
  isDashboardEnabled: async () => holder.dashboardEnabled,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, dashboards, users, widgets, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { DashboardDetailSchema, DashboardItemSchema, DashboardListResponseSchema, DashboardSchema } =
  await import('../types/dashboard.type');
const DashboardRoutes = (await import('./dashboards.route')).default;
const WidgetRoutes = (await import('./widgets.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/dashboards', DashboardRoutes);
app.route('/widgets', WidgetRoutes);

const OWNER = 'r11-dash-owner';
const STRANGER = 'r11-dash-stranger';
const WORKSPACE = 'ws_r11_dash';
const OTHER_WORKSPACE = 'ws_r11_dash_other';

const KEYS = {
  ownerRead: 'sk-lh-r11downerread001',
  ownerWrite: 'sk-lh-r11downerwrite01',
  stranger: 'sk-lh-r11dstranger0001',
  widgetOnly: 'sk-lh-r11dwidgetonly01',
  workspace: 'sk-lh-r11dworkspace001',
} as const;

const call = (
  path: string,
  init: { body?: unknown; key?: string; method?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1${path}`, {
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: init.method ?? 'GET',
  });

const json = async (res: Response) => (await res.json()) as any;

const createBoard = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerWrite) => {
  const res = await call('/dashboards', { body: { title: 'Ops', ...body }, key, method: 'POST' });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

const createWidget = async (key: string = KEYS.ownerWrite) => {
  const res = await call('/widgets', { body: { title: 'Uptime' }, key, method: 'POST' });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

beforeEach(async () => {
  holder.dashboardEnabled = true;
  await serverDB.delete(dashboards);
  await serverDB.delete(widgets);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'Team', primaryOwnerId: OWNER, slug: 'r11-d-team' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: STRANGER, slug: 'r11-d-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);
  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.ownerWrite, OWNER, ['dashboard:write', 'widget:write']),
      key(KEYS.ownerRead, OWNER, ['dashboard:read']),
      key(KEYS.widgetOnly, OWNER, ['widget:write']),
      key(KEYS.stranger, STRANGER, ['dashboard:write', 'widget:write']),
      key(KEYS.workspace, OWNER, ['dashboard:write'], WORKSPACE),
    ]);
});

describe('authentication, scopes and the feature flag', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/dashboards')).status).toBe(401);
  });

  it('refuses a widget key, and a read key on writes', async () => {
    const widgetOnly = await call('/dashboards', { key: KEYS.widgetOnly });
    const readWrite = await call('/dashboards', {
      body: { title: 'Nope' },
      key: KEYS.ownerRead,
      method: 'POST',
    });

    for (const res of [widgetOnly, readWrite]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
  });

  it('answers 403 while dashboards are off for the caller', async () => {
    holder.dashboardEnabled = false;
    expect((await call('/dashboards', { key: KEYS.ownerRead })).status).toBe(403);
  });
});

describe('request validation', () => {
  it('rejects a missing title, a bad id and an out-of-grid layout', async () => {
    const board = await createBoard();

    const responses = await Promise.all([
      call('/dashboards', { body: {}, key: KEYS.ownerWrite, method: 'POST' }),
      call('/dashboards/not-a-uuid', { key: KEYS.ownerRead }),
      call(`/dashboards/${board.id}/layout`, {
        body: { items: [{ id: board.id, layout: { h: 99, w: 1, x: 0, y: 0 } }] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
      call(`/dashboards/${board.id}`, { body: {}, key: KEYS.ownerWrite, method: 'PATCH' }),
    ]);
    for (const res of responses) expect(res.status).toBe(400);
  });
});

describe('boards and layout', () => {
  it('creates, lists, places widgets, saves the layout, removes and deletes', async () => {
    const board = await createBoard({ description: 'On-call' });
    expect(DashboardSchema.parse(board)).toMatchObject({ title: 'Ops', userId: OWNER });

    const list = await json(await call('/dashboards', { key: KEYS.ownerRead }));
    expect(DashboardListResponseSchema.parse(list.data)).toMatchObject({
      items: [expect.objectContaining({ id: board.id })],
      total: 1,
    });

    const widget = await createWidget();
    const placed = await call(`/dashboards/${board.id}/items`, {
      body: { layout: { h: 2, w: 4, x: 0, y: 0 }, widgetId: widget.id },
      key: KEYS.ownerWrite,
      method: 'POST',
    });
    expect(placed.status).toBe(201);
    const item = DashboardItemSchema.parse((await json(placed)).data);
    expect(item).toMatchObject({ dashboardId: board.id, widgetId: widget.id });

    const layout = await json(
      await call(`/dashboards/${board.id}/layout`, {
        body: { items: [{ id: item.id, layout: { h: 3, w: 6, x: 2, y: 1 } }] },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
    );
    expect(layout.data).toEqual({ updated: 1 });

    const detail = await json(await call(`/dashboards/${board.id}`, { key: KEYS.ownerRead }));
    expect(DashboardDetailSchema.parse(detail.data).items).toEqual([
      expect.objectContaining({
        id: item.id,
        layout: { h: 3, w: 6, x: 2, y: 1 },
        widget: expect.objectContaining({ id: widget.id, title: 'Uptime' }),
      }),
    ]);

    const removed = await json(
      await call(`/dashboards/${board.id}/items/${item.id}`, {
        key: KEYS.ownerWrite,
        method: 'DELETE',
      }),
    );
    expect(removed.data).toEqual({ deleted: true, id: item.id });
    const again = await call(`/dashboards/${board.id}/items/${item.id}`, {
      key: KEYS.ownerWrite,
      method: 'DELETE',
    });
    expect(again.status).toBe(404);

    const updated = await json(
      await call(`/dashboards/${board.id}`, {
        body: { title: 'Ops board' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.title).toBe('Ops board');

    const deleted = await json(
      await call(`/dashboards/${board.id}`, { key: KEYS.ownerWrite, method: 'DELETE' }),
    );
    expect(deleted.data).toEqual({ deleted: true, id: board.id });
    expect((await call(`/dashboards/${board.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });

  it('creates a board around a widget in one go', async () => {
    const widget = await createWidget();
    const board = await createBoard({ widgetId: widget.id });

    const detail = await json(await call(`/dashboards/${board.id}`, { key: KEYS.ownerRead }));
    expect(detail.data.items.map((entry: any) => entry.widgetId)).toEqual([widget.id]);
  });
});

describe('ownership and workspace isolation', () => {
  it("never shows or changes another account's board, nor places their widget", async () => {
    const board = await createBoard({ visibility: 'private' });
    const strangerWidget = await createWidget(KEYS.stranger);

    const attempts = [
      call(`/dashboards/${board.id}`, { key: KEYS.stranger }),
      call(`/dashboards/${board.id}`, {
        body: { title: 'Mine' },
        key: KEYS.stranger,
        method: 'PATCH',
      }),
      call(`/dashboards/${board.id}`, { key: KEYS.stranger, method: 'DELETE' }),
      call(`/dashboards/${board.id}/items`, {
        body: { widgetId: strangerWidget.id },
        key: KEYS.stranger,
        method: 'POST',
      }),
      call(`/dashboards/${board.id}/items`, {
        body: { widgetId: strangerWidget.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
  });

  it('refuses a personal key on a workspace and a workspace key on another workspace', async () => {
    const personal = await call('/dashboards', { key: KEYS.ownerWrite, workspaceId: WORKSPACE });
    const otherWorkspace = await call('/dashboards', {
      key: KEYS.workspace,
      workspaceId: OTHER_WORKSPACE,
    });

    for (const res of [personal, otherWorkspace]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('workspace_mismatch');
    }
  });

  it('keeps personal and workspace boards apart', async () => {
    const personal = await createBoard({ title: 'Personal' });
    const team = await createBoard({ title: 'Team' }, KEYS.workspace);

    expect(team.workspaceId).toBe(WORKSPACE);
    expect((await call(`/dashboards/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/dashboards/${team.id}`, { key: KEYS.ownerRead })).status).toBe(404);
  });
});
