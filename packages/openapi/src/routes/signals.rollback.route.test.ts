// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /api/v1/signals/receipts/{id}/rollback` over real HTTP: real auth,
 * API-key rows, RBAC + scope gates and the shared rollback service on PGlite.
 * Receipts live in Redis in production, so only the receipt store is replaced
 * by an in-memory map.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({
  receipts: new Map<string, any>(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/services/agentSignal/services/receiptService', () => ({
  getAgentSignalReceipt: async (id: string) => holder.receipts.get(id),
  listAgentSignalReceipts: async () => ({ receipts: [] }),
  updateAgentSignalReceiptMetadata: async (id: string, metadata: unknown) => {
    const receipt = holder.receipts.get(id);
    if (receipt) holder.receipts.set(id, { ...receipt, metadata });
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { AgentSignalReceiptRollbackSchema } = await import('../types/agent-signal.type');
const SignalRoutes = (await import('./signals.route')).default;

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
app.route('/signals', SignalRoutes);

const OWNER = 'r12-signal-owner';
const STRANGER = 'r12-signal-stranger';

const KEYS = {
  agentRead: 'sk-lh-r12sigagentread1',
  owner: 'sk-lh-r12sigownerkey01',
  stranger: 'sk-lh-r12sigstranger01',
} as const;

const rollback = (id: string, key?: string) =>
  app.request(`/api/v1/signals/receipts/${id}/rollback`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    method: 'POST',
  });

const json = async (res: Response) => (await res.json()) as any;

const receipt = (id: string, extra: Record<string, unknown> = {}) => ({
  agentId: 'agt-1',
  createdAt: Date.now(),
  detail: 'detail',
  id,
  kind: 'memory',
  sourceId: 'src',
  sourceType: 'agent.user.message',
  status: 'applied',
  title: 'Saved a memory',
  topicId: 'tpc-1',
  userId: OWNER,
  ...extra,
});

beforeEach(async () => {
  holder.receipts.clear();
  holder.receipts.set(
    'rcpt-memory',
    receipt('rcpt-memory', {
      metadata: { rollbackStatus: 'available' },
      target: { id: 'mem-gone', memoryLayer: 'preference', operation: 'create', type: 'memory' },
    }),
  );
  holder.receipts.set('rcpt-update', receipt('rcpt-update', { target: { type: 'memory' } }));
  holder.receipts.set(
    'rcpt-done',
    receipt('rcpt-done', { metadata: { rollbackStatus: 'rolled_back' } }),
  );
  holder.receipts.set('rcpt-skill', receipt('rcpt-skill', { kind: 'skill' }));
  holder.receipts.set('rcpt-foreign', receipt('rcpt-foreign', { userId: STRANGER }));

  await serverDB.delete(apiKeys);
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);

  const key = (value: string, userId: string, scopes: string[]) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.owner, OWNER, ['agent:write']),
      key(KEYS.agentRead, OWNER, ['agent:read']),
      key(KEYS.stranger, STRANGER, ['agent:write']),
    ]);
});

describe('POST /signals/receipts/:id/rollback', () => {
  it('answers 401 without credentials and 403 for a read-only key', async () => {
    expect((await rollback('rcpt-memory')).status).toBe(401);

    const res = await rollback('rcpt-memory', KEYS.agentRead);
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe('insufficient_scope');
  });

  it("answers 404 for a missing receipt and for another user's receipt", async () => {
    expect((await rollback('rcpt-missing', KEYS.owner)).status).toBe(404);
    expect((await rollback('rcpt-foreign', KEYS.owner)).status).toBe(404);
    expect((await rollback('rcpt-memory', KEYS.stranger)).status).toBe(404);
    // nothing was touched by the refused calls
    expect(holder.receipts.get('rcpt-memory').metadata.rollbackStatus).toBe('available');
  });

  it('reports the terminal status of each kind of receipt', async () => {
    const cases: [string, string][] = [
      // the memory it created is already gone
      ['rcpt-memory', 'not_found'],
      ['rcpt-update', 'unsupported'],
      ['rcpt-done', 'already_rolled_back'],
      // a skill receipt without a document history snapshot
      ['rcpt-skill', 'unsupported'],
    ];

    for (const [id, status] of cases) {
      const res = await rollback(id, KEYS.owner);
      expect(res.status, id).toBe(200);

      const { data } = await json(res);
      expect(AgentSignalReceiptRollbackSchema.parse(data)).toEqual(data);
      expect(data).toMatchObject({ receiptId: id, status });
    }
    expect(holder.receipts.get('rcpt-memory').metadata.rollbackStatus).toBe('not_found');
  });
});
