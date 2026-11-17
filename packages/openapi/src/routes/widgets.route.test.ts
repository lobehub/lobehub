// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/widgets` over real HTTP: real routes behind the `app.ts` auth and
 * workspace middlewares, real scope gates, controller, REST service and the
 * shared `widget` tRPC procedures and `WidgetService` flow, on PGlite. Only
 * the database handle, the `dashboard` feature flag and the sandbox runner
 * (the one outbound call a run makes) are replaced.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  dashboardEnabled: true,
  run: vi.fn(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/server/services/widget/featureGate', () => ({
  isDashboardEnabled: async () => holder.dashboardEnabled,
}));

vi.mock('@/server/services/widget/sandbox', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createWidgetSandboxRunner: () => ({ run: holder.run }),
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, widgets, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const {
  WidgetDetailSchema,
  WidgetListResponseSchema,
  WidgetPublishResultSchema,
  WidgetRunListResponseSchema,
  WidgetRunSchema,
  WidgetSchema,
  WidgetVersionListResponseSchema,
  WidgetVersionSchema,
} = await import('../types/widget.type');
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
app.route('/widgets', WidgetRoutes);

const OWNER = 'r11-widget-owner';
const STRANGER = 'r11-widget-stranger';
const WORKSPACE = 'ws_r11_widgets';
const OTHER_WORKSPACE = 'ws_r11_widgets_other';
const MISSING = '00000000-0000-4000-8000-000000000000';

const KEYS = {
  agentOnly: 'sk-lh-r11wagentonly001',
  ownerAll: 'sk-lh-r11wownerall0001',
  ownerRead: 'sk-lh-r11wownerread001',
  ownerWrite: 'sk-lh-r11wownerwrite01',
  publishOnly: 'sk-lh-r11wpublishonly1',
  stranger: 'sk-lh-r11wstranger0001',
  workspace: 'sk-lh-r11wworkspace001',
} as const;

const SCRIPT = 'console.log(JSON.stringify({ type: "stat", value: 42 }))';

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

const createWidget = async (body: Record<string, unknown> = {}, key: string = KEYS.ownerAll) => {
  const res = await call('/widgets', { body: { title: 'Revenue', ...body }, key, method: 'POST' });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

const saveDraft = async (widgetId: string, key: string = KEYS.ownerAll) => {
  const res = await call(`/widgets/${widgetId}/drafts`, {
    body: { outputType: 'stat', runtime: 'node', script: SCRIPT },
    key,
    method: 'POST',
  });
  expect(res.status).toBe(201);
  return (await json(res)).data;
};

beforeEach(async () => {
  holder.dashboardEnabled = true;
  holder.run.mockReset();
  holder.run.mockResolvedValue({
    durationMs: 12,
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({ type: 'stat', value: 42 }),
    timedOut: false,
  });

  await serverDB.delete(widgets);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'Team', primaryOwnerId: OWNER, slug: 'r11-w-team' },
    { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: STRANGER, slug: 'r11-w-other' },
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
      key(KEYS.ownerAll, OWNER, ['widget:write', 'widget:publish']),
      key(KEYS.ownerWrite, OWNER, ['widget:write']),
      key(KEYS.ownerRead, OWNER, ['widget:read']),
      key(KEYS.publishOnly, OWNER, ['widget:publish']),
      key(KEYS.agentOnly, OWNER, ['agent:write']),
      key(KEYS.stranger, STRANGER, ['widget:write', 'widget:publish']),
      key(KEYS.workspace, OWNER, ['widget:write'], WORKSPACE),
    ]);
});

describe('authentication, scopes and the feature flag', () => {
  it('answers 401 without credentials', async () => {
    expect((await call('/widgets')).status).toBe(401);
  });

  it('refuses a key without a widget scope', async () => {
    const res = await call('/widgets', { key: KEYS.agentOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('keeps running and publishing behind widget:publish, apart from widget:write', async () => {
    const widget = await createWidget();
    const draft = await saveDraft(widget.id);

    const attempts = [
      call(`/widgets/${widget.id}/dry-run`, {
        body: { confirm: true, versionId: draft.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      call(`/widgets/${widget.id}/publish`, {
        body: { confirm: true, versionId: draft.id },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      call(`/widgets/${widget.id}/runs`, {
        body: { confirm: true },
        key: KEYS.ownerWrite,
        method: 'POST',
      }),
      call(`/widgets/${widget.id}/schedule`, {
        body: { pattern: '0 * * * *' },
        key: KEYS.ownerWrite,
        method: 'PUT',
      }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('insufficient_scope');
    }
    expect(holder.run).not.toHaveBeenCalled();

    // widget:publish alone cannot author.
    const draftRes = await call(`/widgets/${widget.id}/drafts`, {
      body: { outputType: 'stat', runtime: 'node', script: SCRIPT },
      key: KEYS.publishOnly,
      method: 'POST',
    });
    expect(draftRes.status).toBe(403);
  });

  it('answers 403 while dashboards are off for the caller', async () => {
    holder.dashboardEnabled = false;
    const res = await call('/widgets', { key: KEYS.ownerRead });

    expect(res.status).toBe(403);
    expect((await json(res)).message).toContain('not enabled');
  });
});

describe('explicit confirmation before a script runs', () => {
  it('refuses a dry run or publish without confirm: true and a versionId', async () => {
    const widget = await createWidget();
    const draft = await saveDraft(widget.id);

    for (const [path, body] of [
      ['dry-run', { versionId: draft.id }],
      ['dry-run', { confirm: false, versionId: draft.id }],
      ['dry-run', { confirm: true }],
      ['publish', { versionId: draft.id }],
      ['publish', { confirm: true }],
      ['runs', {}],
    ] as const) {
      const res = await call(`/widgets/${widget.id}/${path}`, {
        body,
        key: KEYS.ownerAll,
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.run).not.toHaveBeenCalled();
  });

  it('rejects a malformed widget id', async () => {
    const res = await call('/widgets/not-a-uuid', { key: KEYS.ownerRead });
    expect(res.status).toBe(400);
  });
});

describe('authoring loop: draft → dry run → publish → run', () => {
  it('creates, lists, reads and updates a widget', async () => {
    const widget = await createWidget({ description: 'Monthly' });
    expect(WidgetSchema.parse(widget)).toMatchObject({
      description: 'Monthly',
      publishedVersionId: null,
      title: 'Revenue',
      userId: OWNER,
    });

    const list = await json(await call('/widgets', { key: KEYS.ownerRead }));
    expect(WidgetListResponseSchema.parse(list.data)).toMatchObject({
      hasMore: false,
      items: [expect.objectContaining({ id: widget.id })],
      total: 1,
    });

    const updated = await json(
      await call(`/widgets/${widget.id}`, {
        body: { title: 'MRR' },
        key: KEYS.ownerWrite,
        method: 'PATCH',
      }),
    );
    expect(updated.data.title).toBe('MRR');
  });

  it('refuses publishing a draft that was never dry-run', async () => {
    const widget = await createWidget();
    const draft = await saveDraft(widget.id);

    const res = await call(`/widgets/${widget.id}/publish`, {
      body: { confirm: true, versionId: draft.id },
      key: KEYS.ownerAll,
      method: 'POST',
    });

    expect(res.status).toBe(412);
    expect((await json(res)).code).toBe('precondition_failed');
  });

  it('dry-runs the reviewed version, publishes it, runs it and schedules it', async () => {
    const widget = await createWidget();
    const draft = await saveDraft(widget.id);
    expect(WidgetVersionSchema.parse(draft)).toMatchObject({ status: 'draft', version: 1 });

    const dryRun = await call(`/widgets/${widget.id}/dry-run`, {
      body: { confirm: true, versionId: draft.id },
      key: KEYS.ownerAll,
      method: 'POST',
    });
    expect(dryRun.status).toBe(200);
    expect(WidgetRunSchema.parse((await json(dryRun)).data)).toMatchObject({
      output: { type: 'stat', value: 42 },
      status: 'succeeded',
      trigger: 'preview',
      versionId: draft.id,
    });
    expect(holder.run).toHaveBeenCalledTimes(1);
    expect(holder.run.mock.calls[0][0]).toMatchObject({ runtime: 'node', script: SCRIPT });

    const published = await call(`/widgets/${widget.id}/publish`, {
      body: { confirm: true, versionId: draft.id },
      key: KEYS.ownerAll,
      method: 'POST',
    });
    expect(published.status).toBe(200);
    const result = WidgetPublishResultSchema.parse((await json(published)).data);
    expect(result.widget.publishedVersionId).toBe(draft.id);
    expect(result.version.status).toBe('published');

    const run = await json(
      await call(`/widgets/${widget.id}/runs`, {
        body: { confirm: true },
        key: KEYS.ownerAll,
        method: 'POST',
      }),
    );
    expect(run.data).toMatchObject({ status: 'succeeded', trigger: 'manual' });

    const runs = await json(
      await call(`/widgets/${widget.id}/runs?limit=10`, { key: KEYS.ownerRead }),
    );
    expect(WidgetRunListResponseSchema.parse(runs.data).items.map((item) => item.trigger)).toEqual([
      'manual',
      'preview',
    ]);
    const one = await call(`/widgets/${widget.id}/runs/${run.data.id}`, { key: KEYS.ownerRead });
    expect((await json(one)).data.id).toBe(run.data.id);

    const versions = await json(
      await call(`/widgets/${widget.id}/versions`, { key: KEYS.ownerRead }),
    );
    expect(WidgetVersionListResponseSchema.parse(versions.data).items).toHaveLength(1);
    const version = await call(`/widgets/${widget.id}/versions/${draft.id}`, {
      key: KEYS.ownerRead,
    });
    expect((await json(version)).data.script).toBe(SCRIPT);

    const detail = await json(await call(`/widgets/${widget.id}`, { key: KEYS.ownerRead }));
    expect(WidgetDetailSchema.parse(detail.data)).toMatchObject({
      draftVersion: null,
      latestOutput: { type: 'stat', value: 42 },
      publishedVersion: expect.objectContaining({ id: draft.id }),
    });

    const scheduled = await json(
      await call(`/widgets/${widget.id}/schedule`, {
        body: { pattern: '0 * * * *', timezone: 'UTC' },
        key: KEYS.ownerAll,
        method: 'PUT',
      }),
    );
    expect(scheduled.data).toMatchObject({ schedulePattern: '0 * * * *', scheduleTimezone: 'UTC' });
    expect(scheduled.data.nextRunAt).toEqual(expect.any(String));

    const invalid = await call(`/widgets/${widget.id}/schedule`, {
      body: { pattern: 'every minute' },
      key: KEYS.ownerAll,
      method: 'PUT',
    });
    expect(invalid.status).toBe(400);

    const cleared = await json(
      await call(`/widgets/${widget.id}/schedule`, {
        body: { pattern: null },
        key: KEYS.ownerAll,
        method: 'PUT',
      }),
    );
    expect(cleared.data).toMatchObject({ nextRunAt: null, schedulePattern: null });
  });

  it('answers 404 for an unknown version, and moves a deleted widget to the trash', async () => {
    const widget = await createWidget();

    const missing = await call(`/widgets/${widget.id}/dry-run`, {
      body: { confirm: true, versionId: MISSING },
      key: KEYS.ownerAll,
      method: 'POST',
    });
    expect(missing.status).toBe(404);

    const deleted = await json(
      await call(`/widgets/${widget.id}`, { key: KEYS.ownerWrite, method: 'DELETE' }),
    );
    expect(deleted.data).toEqual({ deleted: true, id: widget.id });
    expect((await call(`/widgets/${widget.id}`, { key: KEYS.ownerRead })).status).toBe(404);

    // Into the trash, as in the app — still restorable, not purged.
    const rows = await serverDB.select().from(widgets);
    expect(rows.find((row) => row.id === widget.id)?.isDeleted).toBe(true);
  });
});

describe('ownership and workspace isolation', () => {
  it("never runs, publishes or edits another account's widget", async () => {
    const widget = await createWidget({ visibility: 'private' });
    const draft = await saveDraft(widget.id);

    const attempts = [
      call(`/widgets/${widget.id}`, { key: KEYS.stranger }),
      call(`/widgets/${widget.id}`, {
        body: { title: 'Mine' },
        key: KEYS.stranger,
        method: 'PATCH',
      }),
      call(`/widgets/${widget.id}`, { key: KEYS.stranger, method: 'DELETE' }),
      call(`/widgets/${widget.id}/versions`, { key: KEYS.stranger }),
      call(`/widgets/${widget.id}/dry-run`, {
        body: { confirm: true, versionId: draft.id },
        key: KEYS.stranger,
        method: 'POST',
      }),
      call(`/widgets/${widget.id}/publish`, {
        body: { confirm: true, versionId: draft.id },
        key: KEYS.stranger,
        method: 'POST',
      }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    expect(holder.run).not.toHaveBeenCalled();
  });

  it('refuses a personal key on a workspace and a workspace key on another workspace', async () => {
    const personal = await call('/widgets', { key: KEYS.ownerWrite, workspaceId: WORKSPACE });
    const otherWorkspace = await call('/widgets', {
      key: KEYS.workspace,
      workspaceId: OTHER_WORKSPACE,
    });

    for (const res of [personal, otherWorkspace]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('workspace_mismatch');
    }
  });

  it('keeps personal and workspace widgets apart', async () => {
    const personal = await createWidget({ title: 'Personal' });
    const team = await createWidget({ title: 'Team' }, KEYS.workspace);

    expect(team.workspaceId).toBe(WORKSPACE);
    expect((await call(`/widgets/${personal.id}`, { key: KEYS.workspace })).status).toBe(404);
    expect((await call(`/widgets/${team.id}`, { key: KEYS.ownerRead })).status).toBe(404);
    const list = await json(await call('/widgets', { key: KEYS.workspace }));
    expect(list.data.items.map((item: any) => item.id)).toEqual([team.id]);
  });
});
