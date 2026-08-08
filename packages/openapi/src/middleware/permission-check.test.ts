import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { requireApiKeyScope } from './permission-check';

// `requireApiKeyScope` never touches the database — stub the db imports pulled
// in by the sibling `requirePermission` middleware to keep this test light
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({ RbacModel: class {} }));

const buildApp = (auth: { authType?: string; scopes?: string[] | null }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (auth.authType) c.set('authType' as never, auth.authType as never);
    c.set('apiKeyScopes' as never, auth.scopes as never);
    await next();
  });
  app.post('/replies', requireApiKeyScope('model:invoke'), (c) => c.json({ ok: true }));

  return app;
};

describe('requireApiKeyScope', () => {
  it('is a no-op for session/OIDC auth', async () => {
    const app = buildApp({ authType: 'oidc' });

    const res = await app.request('/replies', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('lets full-access keys through (legacy NULL and explicit *)', async () => {
    for (const scopes of [null, ['*']]) {
      const app = buildApp({ authType: 'apikey', scopes });

      const res = await app.request('/replies', { method: 'POST' });
      expect(res.status).toBe(200);
    }
  });

  it('rejects restricted keys missing the scope', async () => {
    const app = buildApp({ authType: 'apikey', scopes: ['chat:write'] });

    const res = await app.request('/replies', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('model:invoke');
  });

  it('allows restricted keys holding the scope', async () => {
    const app = buildApp({ authType: 'apikey', scopes: ['model:invoke'] });

    const res = await app.request('/replies', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
