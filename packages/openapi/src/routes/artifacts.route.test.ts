// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/v1/artifacts` over real HTTP: real route behind the `app.ts` auth
 * and workspace middlewares, real scope gate, controller and REST service, on
 * PGlite. The deployment router is LobeHub Cloud's; here it is replaced by the
 * OSS stub (no procedures) or by a stand-in for the cloud one that records the
 * call the service makes.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  cloud: false,
  contexts: [] as unknown[],
  publish: vi.fn(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

vi.mock('@/business/server/lambda-routers/marketDeployments', () => ({
  marketDeploymentsRouter: {
    _def: {
      get procedures() {
        return holder.cloud ? { publishWorkspaceHtml: {} } : {};
      },
    },
    createCaller: (ctx: unknown) => {
      holder.contexts.push(ctx);
      return { publishWorkspaceHtml: holder.publish };
    },
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users, workspaceMembers, workspaces } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { ArtifactDeploymentSchema } = await import('../types/artifact.type');
const ArtifactRoutes = (await import('./artifacts.route')).default;

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
app.route('/artifacts', ArtifactRoutes);

const OWNER = 'r11-artifact-owner';
const STRANGER = 'r11-artifact-stranger';
const WORKSPACE = 'ws_r11_artifacts';

const KEYS = {
  fileOnly: 'sk-lh-r11afileonly0001',
  owner: 'sk-lh-r11aowner0000001',
  workspace: 'sk-lh-r11aworkspace001',
} as const;

const DEPLOYMENT = {
  artifactIdentifier: 'api:x',
  id: 'dep_r11',
  kind: 'site',
  latestRevisionNumber: 1,
  publicUrl: 'https://r11-report.lobehub.app',
  status: 'active',
  subdomainLabel: 'r11-report',
  title: 'Report',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const call = (body: unknown, init: { key?: string; workspaceId?: string } = {}) =>
  app.request('/api/v1/artifacts', {
    body: JSON.stringify(body),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: 'POST',
  });

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  holder.cloud = false;
  holder.contexts = [];
  holder.publish.mockReset();
  holder.publish.mockResolvedValue({ data: DEPLOYMENT, success: true });

  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'Team', primaryOwnerId: OWNER, slug: 'r11-a-team' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
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
      key(KEYS.owner, OWNER, ['artifact:publish']),
      key(KEYS.fileOnly, OWNER, ['file:write']),
      key(KEYS.workspace, OWNER, ['artifact:publish'], WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    expect((await call({ html: '<h1>Hi</h1>' })).status).toBe(401);
  });

  it('refuses a key without artifact:publish', async () => {
    holder.cloud = true;
    const res = await call({ html: '<h1>Hi</h1>' }, { key: KEYS.fileOnly });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
    expect(holder.publish).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  it('rejects a missing page, an empty page and too many sidecar files', async () => {
    holder.cloud = true;
    const file = { content: 'x', contentType: 'text/css', encoding: 'utf8', path: 'a.css' };

    for (const body of [
      {},
      { html: '' },
      { files: Array.from({ length: 65 }, () => file), html: 'x' },
    ]) {
      const res = await call(body, { key: KEYS.owner });
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('validation_error');
    }
    expect(holder.publish).not.toHaveBeenCalled();
  });
});

describe('publishing', () => {
  it('answers 404 on a server without artifact publishing', async () => {
    const res = await call({ html: '<h1>Hi</h1>' }, { key: KEYS.owner });

    expect(res.status).toBe(404);
    expect((await json(res)).message).toContain('not available');
  });

  it('creates a site through the deployment procedure', async () => {
    holder.cloud = true;
    const res = await call(
      {
        files: [{ content: 'body{}', contentType: 'text/css', encoding: 'utf8', path: 'app.css' }],
        html: '<link rel="stylesheet" href="app.css"><h1>Report</h1>',
        title: 'Report',
      },
      { key: KEYS.owner },
    );

    expect(res.status).toBe(201);
    expect(ArtifactDeploymentSchema.parse((await json(res)).data)).toEqual({
      id: 'dep_r11',
      latestRevisionNumber: 1,
      publicUrl: 'https://r11-report.lobehub.app',
      status: 'active',
      subdomainLabel: 'r11-report',
      title: 'Report',
      updatedAt: '2026-11-18T00:00:00.000Z',
    });
    expect(holder.contexts).toEqual([{ userId: OWNER, workspaceId: undefined }]);
    expect(holder.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactIdentifier: expect.stringMatching(/^api:/),
        files: [expect.objectContaining({ path: 'app.css' })],
        requestedSlug: 'Report',
        target: { kind: 'create' },
        title: 'Report',
      }),
    );
  });

  it('publishes a new revision of an existing deployment in the workspace', async () => {
    holder.cloud = true;
    const res = await call(
      { artifactIdentifier: 'report', deploymentId: 'dep_r11', html: '<h1>v2</h1>', slug: 'q4' },
      { key: KEYS.workspace },
    );

    expect(res.status).toBe(201);
    expect(holder.contexts).toEqual([{ userId: OWNER, workspaceId: WORKSPACE }]);
    expect(holder.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactIdentifier: 'report',
        requestedSlug: 'q4',
        target: { deploymentId: 'dep_r11', kind: 'deployment' },
      }),
    );
  });

  it("surfaces the deployment procedure's refusal with its status", async () => {
    holder.cloud = true;
    holder.publish.mockRejectedValue(
      Object.assign(new Error('Deployment not found'), { code: 'NOT_FOUND', name: 'TRPCError' }),
    );

    const res = await call({ deploymentId: 'dep_other', html: 'x' }, { key: KEYS.owner });
    expect(res.status).toBe(404);
  });
});

describe('workspace isolation', () => {
  it('refuses a personal key on a workspace and a non-member workspace', async () => {
    holder.cloud = true;
    const personal = await call({ html: 'x' }, { key: KEYS.owner, workspaceId: WORKSPACE });
    const otherWorkspace = await call(
      { html: 'x' },
      { key: KEYS.workspace, workspaceId: 'ws_r11_someone_else' },
    );

    for (const res of [personal, otherWorkspace]) {
      expect(res.status).toBe(403);
      expect((await json(res)).code).toBe('workspace_mismatch');
    }
    expect(holder.publish).not.toHaveBeenCalled();
  });
});
