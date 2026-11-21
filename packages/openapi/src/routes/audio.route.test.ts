import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

// The route checks both the issuer's RBAC invoke permission and the key's scope.
let rbacAllows = true;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => rbacAllows;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../controllers/audio.controller', () => ({
  AudioController: class {
    handleSpeech() {
      return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  },
}));

const { default: AudioRoutes } = await import('./audio.route');

const requestAs = (apiKeyScopes: string[], allowRbac = true) => {
  rbacAllows = allowRbac;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, apiKeyScopes as never);
    await next();
  });
  app.route('/', AudioRoutes);

  return app.request('/speech', {
    body: JSON.stringify({ input: 'hi', model: 'tts-1' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
};

describe('POST /audio/speech access', () => {
  it('accepts a key holding model:invoke', async () => {
    const res = await requestAs(['model:invoke']);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('rejects a key without model:invoke', async () => {
    const res = await requestAs(['chat:read']);

    expect(res.status).toBe(403);
  });

  it('rejects an issuer without the model invoke permission, whatever the key scope', async () => {
    const res = await requestAs(['model:invoke'], false);

    expect(res.status).toBe(403);
  });
});
