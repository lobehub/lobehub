// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LiveActivityModule from '@/business/server/notification/liveActivity';

/**
 * `PUT /api/v1/push-tokens/{deviceId}/live-activities` over real HTTP: real
 * auth, API-key rows, workspace binding and scope gate on PGlite. The token
 * store is the OSS module (no ActivityKit support), spied on to see what the
 * route hands it.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ registered: [] as unknown[], serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/business/server/notification/liveActivity', async (importOriginal) => {
  const original = await importOriginal<typeof LiveActivityModule>();
  return {
    ...original,
    registerAgentInterventionLiveActivity: async (params: unknown) => {
      holder.registered.push(params);
      return original.registerAgentInterventionLiveActivity(params as never);
    },
  };
});

const { getTestDB } = await import('@/database/core/getTestDB');
const { agentOperations, apiKeys, pushTokens, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { LiveActivityRegistrationSchema } = await import('../types/im.type');
const PushTokenRoutes = (await import('./push-tokens.route')).default;

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
app.route('/push-tokens', PushTokenRoutes);

const OWNER = 'r12-live-owner';
const STRANGER = 'r12-live-stranger';
const WORKSPACE = 'r12-live-ws';

const KEYS = {
  agentOnly: 'sk-lh-r12liveagentonly',
  owner: 'sk-lh-r12liveownerkey1',
  stranger: 'sk-lh-r12livestranger1',
  workspace: 'sk-lh-r12liveworkspace',
} as const;

const body = (operationId: string) => ({
  activityId: 'act-local-1',
  activityKey: `intervention:${operationId}`,
  apnsEnvironment: 'production',
  operationId,
  pushToken: 'apns-update-token',
});

const register = (
  deviceId: string,
  init: { body?: unknown; key?: string; workspaceId?: string } = {},
) =>
  app.request(`/api/v1/push-tokens/${deviceId}/live-activities`, {
    body: JSON.stringify(init.body ?? body('op-own')),
    headers: {
      ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
      ...(init.workspaceId ? { 'x-workspace-id': init.workspaceId } : {}),
      'content-type': 'application/json',
    },
    method: 'PUT',
  });

const json = async (res: Response) => (await res.json()) as any;

beforeEach(async () => {
  holder.registered = [];
  await serverDB.delete(agentOperations);
  await serverDB.delete(pushTokens);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values([{ id: WORKSPACE, name: 'R12 live', primaryOwnerId: OWNER, slug: 'r12-live' }]);
  await serverDB
    .insert(workspaceMembers)
    .values([{ role: 'owner', userId: OWNER, workspaceId: WORKSPACE }]);
  await serverDB.insert(pushTokens).values([
    { deviceId: 'device-own', expoToken: 'ExponentPushToken[own]', platform: 'ios', userId: OWNER },
    {
      deviceId: 'device-stranger',
      expoToken: 'ExponentPushToken[str]',
      platform: 'ios',
      userId: STRANGER,
    },
  ]);
  await serverDB.insert(agentOperations).values([
    { id: 'op-own', status: 'waiting_for_human', userId: OWNER },
    { id: 'op-stranger', status: 'waiting_for_human', userId: STRANGER },
    { id: 'op-ws', status: 'waiting_for_human', userId: OWNER, workspaceId: WORKSPACE },
  ] as any);

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
      key(KEYS.owner, OWNER, ['chat:read']),
      key(KEYS.agentOnly, OWNER, ['agent:read']),
      key(KEYS.stranger, STRANGER, ['chat:read']),
      key(KEYS.workspace, OWNER, ['chat:read'], WORKSPACE),
    ]);
});

describe('PUT /push-tokens/:deviceId/live-activities', () => {
  it('answers 401 without credentials and 403 without chat:read', async () => {
    expect((await register('device-own')).status).toBe(401);

    const res = await register('device-own', { key: KEYS.agentOnly });
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('hands the registration to the token store and returns the intervention state', async () => {
    const res = await register('device-own', { key: KEYS.owner });
    expect(res.status).toBe(200);

    const { data } = await json(res);
    expect(LiveActivityRegistrationSchema.parse(data)).toEqual({
      interventionStatus: 'unavailable',
      interventionTerminal: true,
    });
    expect(holder.registered).toEqual([
      { ...body('op-own'), deviceId: 'device-own', userId: OWNER, workspaceId: undefined },
    ]);
  });

  it("answers 404 for another user's device or run", async () => {
    expect((await register('device-stranger', { key: KEYS.owner })).status).toBe(404);
    expect((await register('device-unknown', { key: KEYS.owner })).status).toBe(404);
    expect(
      (await register('device-own', { body: body('op-stranger'), key: KEYS.owner })).status,
    ).toBe(404);
    expect(holder.registered).toEqual([]);
  });

  it('keeps workspace runs to their workspace', async () => {
    // a workspace run is not visible from the personal scope …
    expect((await register('device-own', { body: body('op-ws'), key: KEYS.owner })).status).toBe(
      404,
    );
    // … a personal run is not visible from the workspace …
    expect(
      (await register('device-own', { key: KEYS.workspace, workspaceId: WORKSPACE })).status,
    ).toBe(404);

    // … and a workspace credential registers for a workspace run
    const res = await register('device-own', {
      body: body('op-ws'),
      key: KEYS.workspace,
      workspaceId: WORKSPACE,
    });
    expect(res.status).toBe(200);
    expect(holder.registered).toMatchObject([{ operationId: 'op-ws', workspaceId: WORKSPACE }]);
  });

  it('validates the body', async () => {
    for (const invalid of [
      {},
      { ...body('op-own'), apnsEnvironment: 'staging' },
      { ...body('op-own'), pushToken: '' },
      { ...body('op-own'), activityKey: 'x'.repeat(201) },
    ]) {
      const res = await register('device-own', { body: invalid, key: KEYS.owner });
      expect(res.status, JSON.stringify(invalid)).toBe(400);
    }
  });
});
