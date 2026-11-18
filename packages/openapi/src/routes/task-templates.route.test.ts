// @vitest-environment node
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/v1/task-templates` over real HTTP: real auth + workspace
 * middlewares, scope gate, controller, REST service, `taskTemplate` procedure
 * and `TaskTemplateService` on PGlite with real `api_keys` rows. Only the
 * market client is stubbed — recommendations come from the LobeHub market over
 * the network — and the request it received is asserted.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');

const holder = vi.hoisted(() => ({ serverDB: undefined as unknown }));
const market = vi.hoisted(() => ({ getTaskTemplateRecommendations: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));
vi.mock('@/server/services/market', () => ({
  MarketService: class {
    market = { taskTemplates: market };
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const { apiKeys, users } = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const { TaskTemplateSchema } = await import('../types/task-template.type');
const TaskTemplateRoutes = (await import('./task-templates.route')).default;

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
app.route('/task-templates', TaskTemplateRoutes);

const USER = 'r10-template-user';
const KEYS = { agentRead: 'sk-lh-r10tplagentrd001', chatOnly: 'sk-lh-r10tplchatonly01' } as const;

const TEMPLATE = {
  category: 'engineering',
  connectors: [{ identifier: 'github', required: true, source: 'lobehub' }],
  cronPattern: '0 9 * * 1,2,3,4,5',
  description: 'Summarise yesterday’s pull requests.',
  icon: 'github',
  id: 7,
  identifier: 'daily-pr-digest',
  instruction: 'List the pull requests merged yesterday and summarise each.',
  interests: ['coding'],
  title: 'Daily PR digest',
};

const call = (path: string, key?: string) =>
  app.request(`/api/v1${path}`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

beforeEach(async () => {
  market.getTaskTemplateRecommendations.mockReset();
  market.getTaskTemplateRecommendations.mockResolvedValue({ items: [TEMPLATE] });
  await serverDB.delete(apiKeys);
  await serverDB.delete(users);
  await serverDB.insert(users).values({ id: USER });
  await serverDB.insert(apiKeys).values(
    Object.entries({ agentRead: ['agent:read'], chatOnly: ['chat:read'] }).map(([name, scopes]) => {
      const key = KEYS[name as keyof typeof KEYS];
      return { key, keyHash: hashApiKey(key), name, scopes, userId: USER };
    }),
  );
});

describe('GET /task-templates', () => {
  it('returns the recommended templates for the given interests', async () => {
    const res = await call(
      '/task-templates?interestKeys=coding,%20writing&count=3&locale=zh-CN',
      KEYS.agentRead,
    );
    const body = (await res.json()) as any;

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(TaskTemplateSchema.array().parse(body.data)).toEqual([TEMPLATE]);
    expect(market.getTaskTemplateRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ count: 3, interestKeys: ['coding', 'writing'], locale: 'zh-CN' }),
    );
  });

  it('answers 401 without credentials', async () => {
    expect((await call('/task-templates')).status).toBe(401);
  });

  it('refuses a key without an agent scope', async () => {
    const res = await call('/task-templates', KEYS.chatOnly);

    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe('insufficient_scope');
  });

  it('rejects a count above the recommendation cap', async () => {
    const res = await call('/task-templates?count=50', KEYS.agentRead);

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe('validation_error');
    expect(market.getTaskTemplateRecommendations).not.toHaveBeenCalled();
  });
});
