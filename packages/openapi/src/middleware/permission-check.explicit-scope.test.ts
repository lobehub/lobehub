import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type * as ApiKeyScopeModule from '@/const/apiKeyScope';

/**
 * Explicit scopes (`API_KEY_EXPLICIT_SCOPES`) are never implied by full
 * access. The list is empty until a scope opts in, so this suite pretends
 * `model:invoke` is one and checks the REST gates honour it: a full-access
 * credential must name it, while unnarrowed (session / unscoped OAuth)
 * credentials still pass.
 */
vi.mock('@/const/apiKeyScope', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiKeyScopeModule>();
  const isExplicitApiKeyScope = (scope: string) => scope === 'model:invoke';
  return {
    ...actual,
    hasApiKeyScope: (scopes: string[] | null | undefined, required: any) =>
      isExplicitApiKeyScope(required)
        ? !!scopes?.includes(required)
        : actual.hasApiKeyScope(scopes, required),
    isExplicitApiKeyScope,
  };
});
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));

const { requireAnyPermissionWithApiKeyScope, requireApiKeyScope } =
  await import('./permission-check');

const buildApp = (auth: { authType?: string; scopes?: string[] | null }) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (auth.authType) c.set('authType' as never, auth.authType as never);
    c.set('apiKeyScopes' as never, auth.scopes as never);
    c.set('userId' as never, 'user-1' as never);
    await next();
  });
  app.post('/replies', requireApiKeyScope('model:invoke'), (c) => c.json({ ok: true }));
  app.post('/invoke', requireAnyPermissionWithApiKeyScope(['ai_model:read'], 'model:invoke'), (c) =>
    c.json({ ok: true }),
  );
  return app;
};

describe('explicit scopes', () => {
  it('refuses a full-access key that does not name the explicit scope', async () => {
    for (const scopes of [null, ['*']]) {
      const app = buildApp({ authType: 'apikey', scopes });

      for (const path of ['/replies', '/invoke']) {
        const res = await app.request(path, { method: 'POST' });
        expect(res.status).toBe(403);
      }
    }
  });

  it('lets a full-access key through once it names the explicit scope', async () => {
    const app = buildApp({ authType: 'apikey', scopes: ['*', 'model:invoke'] });

    for (const path of ['/replies', '/invoke']) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(200);
    }
  });

  it('lets an unnarrowed credential through', async () => {
    const app = buildApp({ authType: 'oidc', scopes: undefined });

    for (const path of ['/replies', '/invoke']) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(200);
    }
  });

  it('refuses a scoped OAuth token without it', async () => {
    const app = buildApp({ authType: 'oidc', scopes: ['agent:read'] });

    expect((await app.request('/replies', { method: 'POST' })).status).toBe(403);
  });
});
