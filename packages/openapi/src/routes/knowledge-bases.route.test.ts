import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { successEnvelope } from '../common/openapi';
import { DeletedResourceSchema } from '../types/common.type';

// The route and the real controller run; only the db, auth and the knowledge
// base service behind the controller are stubbed.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../services/knowledge-base.service', () => ({
  KnowledgeBaseService: class {
    deleteKnowledgeBase = async (id: string) => ({ deleted: true, id });
  },
}));

const { default: KnowledgeBaseRoutes } = await import('./knowledge-bases.route');

const request = (path: string, method: string) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'oidc' as never);
    await next();
  });
  app.route('/', KnowledgeBaseRoutes);
  return app.request(path, { method });
};

describe('DELETE /knowledge-bases/:id', () => {
  it('answers with the deleted knowledge base id inside the success envelope', async () => {
    const res = await request('/kb-1', 'DELETE');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ deleted: true, id: 'kb-1' });
    expect(() => successEnvelope(DeletedResourceSchema).parse(body)).not.toThrow();
  });
});
