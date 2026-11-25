// @vitest-environment node
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listServers } = vi.hoisted(() => ({ listServers: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../services/mcp-server.service', () => ({
  McpServerService: class {
    listServers = listServers;
  },
}));

const { default: McpServersRoutes } = await import('./mcp-servers.route');
const { McpServerSchema } = await import('../types/mcp-server.type');
const { paginatedListSchema } = await import('../helpers/pagination');

const server = (i: number) => ({
  createdAt: new Date(2026, 0, i + 1).toISOString(),
  description: null,
  hasCredentials: false,
  id: `00000000-0000-4000-8000-00000000000${i}`,
  identifier: `server-${i}`,
  isEnabled: true,
  name: `Server ${i}`,
  serverUrl: `https://mcp${i}.example.com/mcp`,
  status: 'connected' as const,
  tools: [],
  updatedAt: new Date(2026, 0, i + 1).toISOString(),
});

const request = (
  path: string,
  { scopes = null, userId = 'user-1' }: { scopes?: string[] | null; userId?: string | null } = {},
) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    if (scopes) {
      c.set('authType' as never, 'apikey' as never);
      c.set('apiKeyScopes' as never, scopes as never);
    }
    await next();
  });
  app.route('/', McpServersRoutes);
  app.onError((error, c) =>
    c.json({ error: error.message }, error instanceof HTTPException ? error.status : 500),
  );
  return app.request(path);
};

const data = async (res: Response) => ((await res.json()) as { data: any }).data;

beforeEach(() => {
  listServers.mockReset();
  listServers.mockResolvedValue([0, 1, 2].map(server));
});

describe('GET /mcp-servers', () => {
  it('requires authentication', async () => {
    expect((await request('/', { userId: null })).status).toBe(401);
    expect(listServers).not.toHaveBeenCalled();
  });

  it('refuses a restricted API key without mcp:read', async () => {
    const res = await request('/', { scopes: ['agent:read'] });
    expect(res.status).toBe(403);
    expect(listServers).not.toHaveBeenCalled();
  });

  it('answers the paginated list object by default', async () => {
    const page = await data(await request('/'));
    expect(() => paginatedListSchema(McpServerSchema, { total: true }).parse(page)).not.toThrow();
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, total: 3 });
  });

  it('pages with limit + cursor', async () => {
    const first = await data(await request('/?limit=2'));
    expect(first).toMatchObject({ hasMore: true, total: 3 });
    expect(first.items).toHaveLength(2);

    const second = await data(await request(`/?limit=2&cursor=${first.nextCursor}`));
    expect(second.items.map((s: { identifier: string }) => s.identifier)).toEqual(['server-2']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('rejects an invalid cursor with validation_error', async () => {
    const res = await request('/?cursor=%2F%2F%2F');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'validation_error' });
  });

  it('keeps the legacy bare array behind format=array', async () => {
    const legacy = await data(await request('/?format=array'));
    expect(Array.isArray(legacy)).toBe(true);
    expect(() => McpServerSchema.array().parse(legacy)).not.toThrow();
    expect(legacy).toHaveLength(3);
  });
});
