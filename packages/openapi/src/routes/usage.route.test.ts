import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// The route only declares an API-key scope gate; workspace membership is
// checked upstream by `workspaceAuthMiddleware`. RBAC is stubbed to deny
// everything so a case passes only if the route no longer asks for an RBAC
// permission a workspace viewer lacks.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => false;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers/usage.controller', () => ({
  UsageController: class {
    getUsage(c: any) {
      return c.json({ data: { quota: null }, success: true });
    }
  },
}));

const { default: UsageRoutes } = await import('./usage.route');

const requestAs = (auth: {
  apiKeyScopes?: string[];
  authType: 'apikey' | 'oidc';
  workspaceRole?: string;
}) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, auth.authType as never);
    c.set('apiKeyScopes' as never, auth.apiKeyScopes as never);
    if (auth.workspaceRole) {
      c.set('workspaceId' as never, 'ws-1' as never);
      c.set('workspaceRole' as never, auth.workspaceRole as never);
    }
    await next();
  });
  app.route('/', UsageRoutes);

  return app.request('/');
};

describe('GET /usage access', () => {
  it('lets a workspace viewer read their own usage summary', async () => {
    const res = await requestAs({ authType: 'oidc', workspaceRole: 'viewer' });

    expect(res.status).toBe(200);
  });

  it('accepts a key holding usage:read', async () => {
    const res = await requestAs({ apiKeyScopes: ['usage:read'], authType: 'apikey' });

    expect(res.status).toBe(200);
  });

  it('rejects a key without usage:read', async () => {
    const res = await requestAs({ apiKeyScopes: ['file:read'], authType: 'apikey' });

    expect(res.status).toBe(403);
  });
});
