import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import {
  requireAnyPermission,
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from './permission-check';

const hasAnyPermissions = vi.hoisted(() => vi.fn().mockResolvedValue(true));

// `requireApiKeyScope` never touches the database — stub the db imports pulled
// in by the sibling `requirePermission` middleware to keep this test light
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = hasAnyPermissions;
  },
}));

const buildApp = (auth: { authType?: string; scopes?: string[] | null }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (auth.authType) c.set('authType' as never, auth.authType as never);
    c.set('apiKeyScopes' as never, auth.scopes as never);
    c.set('userId' as never, 'user-1' as never);
    await next();
  });
  app.post('/replies', requireApiKeyScope('model:invoke'), (c) => c.json({ ok: true }));
  app.get('/api-keys', requireAnyPermission(['api_key:create']), (c) => c.json({ ok: true }));
  app.get('/mcp-servers', requireAnyPermissionWithApiKeyScope(['agent:read'], 'mcp:read'), (c) =>
    c.json({ ok: true }),
  );
  app.get('/usage', requireAnyPermissionWithApiKeyScope(['api_key:read'], 'usage:read'), (c) =>
    c.json({ ok: true }),
  );

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

  it('blocks restricted keys from API key administration even with other scopes', async () => {
    const app = buildApp({ authType: 'apikey', scopes: ['user:write'] });
    const response = await app.request('/api-keys');

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('not available to restricted API keys');
  });

  it('projects internal RBAC permissions onto an explicit public API scope', async () => {
    const mcpResponse = await buildApp({ authType: 'apikey', scopes: ['mcp:read'] }).request(
      '/mcp-servers',
    );
    const usageResponse = await buildApp({ authType: 'apikey', scopes: ['usage:read'] }).request(
      '/usage',
    );

    expect(mcpResponse.status).toBe(200);
    expect(usageResponse.status).toBe(200);
  });

  it('does not accept the RBAC resource scope in place of the explicit public scope', async () => {
    const mcpResponse = await buildApp({ authType: 'apikey', scopes: ['agent:read'] }).request(
      '/mcp-servers',
    );
    const usageResponse = await buildApp({ authType: 'apikey', scopes: ['user:read'] }).request(
      '/usage',
    );

    expect(mcpResponse.status).toBe(403);
    expect(await mcpResponse.text()).toContain('mcp:read');
    expect(usageResponse.status).toBe(403);
    expect(await usageResponse.text()).toContain('usage:read');
  });

  it('still requires issuer RBAC when the API key has the explicit scope', async () => {
    hasAnyPermissions.mockResolvedValueOnce(false);
    const response = await buildApp({ authType: 'apikey', scopes: ['mcp:read'] }).request(
      '/mcp-servers',
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain('Insufficient permissions');
  });

  it('lets an MCP write scope satisfy MCP reads', async () => {
    const response = await buildApp({ authType: 'apikey', scopes: ['mcp:write'] }).request(
      '/mcp-servers',
    );

    expect(response.status).toBe(200);
  });
});
