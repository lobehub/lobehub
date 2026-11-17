// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/transfer-requests` over real HTTP: the real routes behind the same
 * auth + workspace middlewares `app.ts` mounts, the real scope gates and the
 * shared `agent.transferAgent` / `resourceTransferRequest` procedures, on a
 * PGlite database with real `api_keys` rows. Only the database handle is
 * pointed at PGlite.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { agents, apiKeys, resourceTransferRequests, users, workspaceMembers, workspaces } =
  await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { eq } = await import('drizzle-orm');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const TransferRequestRoutes = (await import('./transfer-requests.route')).default;

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
app.route('/transfer-requests', TransferRequestRoutes);

const OWNER = 'r9-xfer-owner';
const RECIPIENT = 'r9-xfer-recipient';
const BYSTANDER = 'r9-xfer-bystander';
const STRANGER = 'r9-xfer-stranger';
const WORKSPACE = 'r9-xfer-ws';
const OTHER_WORKSPACE = 'r9-xfer-other-ws';
const AGENT = 'agt_r9xfer';

/** `sk-lh-` + 16 lowercase alphanumerics, bound to the workspace they address. */
const KEYS = {
  bystander: 'sk-lh-r9xferbystander1',
  owner: 'sk-lh-r9xferownerfull1',
  ownerRead: 'sk-lh-r9xferownerread1',
  recipient: 'sk-lh-r9xferrecipient1',
  stranger: 'sk-lh-r9xferstranger01',
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

const requestTransfer = (key: string = KEYS.owner) =>
  call('/transfer-requests', {
    body: { recipientId: RECIPIENT, resourceId: AGENT, resourceType: 'agent' },
    key,
    method: 'POST',
  });

beforeEach(async () => {
  await serverDB.delete(resourceTransferRequests);
  await serverDB.delete(agents);
  await serverDB.delete(apiKeys);
  await serverDB.delete(workspaceMembers);
  await serverDB.delete(workspaces);
  await serverDB.delete(users);

  await serverDB
    .insert(users)
    .values([
      { fullName: 'Owner', id: OWNER },
      { fullName: 'Recipient', id: RECIPIENT },
      { id: BYSTANDER },
      { id: STRANGER },
    ]);
  await serverDB.insert(workspaces).values([
    { id: WORKSPACE, name: 'R9 xfer', primaryOwnerId: OWNER, slug: 'r9-xfer' },
    { id: OTHER_WORKSPACE, name: 'R9 other', primaryOwnerId: STRANGER, slug: 'r9-xfer-other' },
  ]);
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: OWNER, workspaceId: WORKSPACE },
    { role: 'member', userId: RECIPIENT, workspaceId: WORKSPACE },
    { role: 'member', userId: BYSTANDER, workspaceId: WORKSPACE },
    { role: 'owner', userId: STRANGER, workspaceId: OTHER_WORKSPACE },
  ]);
  await serverDB.insert(agents).values({
    id: AGENT,
    title: 'Handover',
    userId: OWNER,
    visibility: 'public',
    workspaceId: WORKSPACE,
  });

  const key = (value: string, userId: string, scopes: string[], workspaceId: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.owner, OWNER, ['*'], WORKSPACE),
      key(KEYS.ownerRead, OWNER, ['workspace:read'], WORKSPACE),
      key(KEYS.recipient, RECIPIENT, ['*'], WORKSPACE),
      key(KEYS.bystander, BYSTANDER, ['*'], WORKSPACE),
      key(KEYS.stranger, STRANGER, ['*'], OTHER_WORKSPACE),
    ]);
});

describe('authentication and API-key scopes', () => {
  it('answers 401 without credentials', async () => {
    const res = await call('/transfer-requests');

    expect(res.status).toBe(401);
  });

  it('keeps restricted keys out entirely — a handover is a decision between people', async () => {
    const list = await call('/transfer-requests', { key: KEYS.ownerRead });
    expect(list.status).toBe(403);
    expect((await json(list)).code).toBe('insufficient_scope');

    const res = await requestTransfer(KEYS.ownerRead);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it('refuses a workspace-bound key addressing another workspace', async () => {
    const res = await call('/transfer-requests', { key: KEYS.owner, workspaceId: OTHER_WORKSPACE });

    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('workspace_mismatch');
  });
});

describe('request validation', () => {
  it.each([
    [
      'an unsupported resource type',
      { recipientId: RECIPIENT, resourceId: AGENT, resourceType: 'file' },
    ],
    ['a missing recipient', { resourceId: AGENT, resourceType: 'agent' }],
    [
      'an unknown field',
      { recipientId: RECIPIENT, resourceId: AGENT, resourceType: 'agent', x: 1 },
    ],
  ])('rejects %s', async (_label, body) => {
    const res = await call('/transfer-requests', { body, key: KEYS.owner, method: 'POST' });

    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('validation_error');
  });
});

describe('handover lifecycle', () => {
  it('creates a request both parties see and the recipient accepts', async () => {
    const created = await requestTransfer();
    expect(created.status).toBe(201);
    const request = (await json(created)).data;
    expect(request).toMatchObject({
      initiator: expect.objectContaining({ fullName: 'Owner', id: OWNER }),
      recipient: expect.objectContaining({ id: RECIPIENT }),
      resource: expect.objectContaining({ id: AGENT, title: 'Handover' }),
      resourceId: AGENT,
      resourceType: 'agent',
      status: 'pending',
    });

    const asRecipient = await json(await call('/transfer-requests', { key: KEYS.recipient }));
    expect(asRecipient.data).toMatchObject({ total: 1 });
    expect(asRecipient.data.items[0].id).toBe(request.id);

    const asBystander = await json(await call('/transfer-requests', { key: KEYS.bystander }));
    expect(asBystander.data.items).toEqual([]);

    const accepted = await call(`/transfer-requests/${request.id}/accept`, {
      key: KEYS.recipient,
      method: 'POST',
    });
    expect(accepted.status).toBe(200);
    expect((await json(accepted)).data).toEqual({ id: request.id, status: 'accepted' });

    const [agent] = await serverDB.select().from(agents).where(eq(agents.id, AGENT));
    expect(agent.userId).toBe(RECIPIENT);
  });

  it('answers 409 for a second pending request on the same resource', async () => {
    expect((await requestTransfer()).status).toBe(201);

    expect((await requestTransfer()).status).toBe(409);
  });

  it('hides a request from anyone but its parties', async () => {
    const request = (await json(await requestTransfer())).data;

    const bystander = await call(`/transfer-requests/${request.id}/accept`, {
      key: KEYS.bystander,
      method: 'POST',
    });
    expect(bystander.status).toBe(404);

    // The initiator cannot accept their own request either.
    const initiator = await call(`/transfer-requests/${request.id}/accept`, {
      key: KEYS.owner,
      method: 'POST',
    });
    expect(initiator.status).toBe(404);

    // Declining answers the same for "not yours" and "no such request", so
    // another workspace cannot probe ids either way.
    const stranger = await call(`/transfer-requests/${request.id}/decline`, {
      key: KEYS.stranger,
      method: 'POST',
    });
    const missing = await call('/transfer-requests/00000000-0000-4000-8000-000000000000/decline', {
      key: KEYS.stranger,
      method: 'POST',
    });
    expect(stranger.status).toBe(409);
    expect(missing.status).toBe(409);

    const stillPending = await json(await call('/transfer-requests', { key: KEYS.recipient }));
    expect(stillPending.data.items[0]).toMatchObject({ id: request.id, status: 'pending' });
  });

  it('lets the recipient decline and the initiator cancel', async () => {
    const first = (await json(await requestTransfer())).data;
    const declined = await call(`/transfer-requests/${first.id}/decline`, {
      key: KEYS.recipient,
      method: 'POST',
    });
    expect((await json(declined)).data).toEqual({ id: first.id, status: 'declined' });

    const second = (await json(await requestTransfer())).data;
    const cancelled = await call(`/transfer-requests/${second.id}/cancel`, {
      key: KEYS.owner,
      method: 'POST',
    });
    expect((await json(cancelled)).data).toEqual({ id: second.id, status: 'cancelled' });

    const [agent] = await serverDB.select().from(agents).where(eq(agents.id, AGENT));
    expect(agent.userId).toBe(OWNER);
  });

  it('refuses a handover started by someone without transfer authority', async () => {
    const res = await requestTransfer(KEYS.bystander);

    expect(res.status).toBe(403);
  });
});
