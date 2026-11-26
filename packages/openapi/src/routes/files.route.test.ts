import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { successEnvelope } from '../common/openapi';
import { DeletedResourceSchema } from '../types/common.type';

// The route and the real controller run; only the db, auth and the file
// service behind the controller are stubbed.
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => next(),
}));
vi.mock('../services/file.service', () => ({
  FileUploadService: class {
    deleteFile = async (id: string) => ({ deleted: true, id });
  },
}));

const { default: FileRoutes } = await import('./files.route');

const request = (path: string, method: string) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'oidc' as never);
    await next();
  });
  app.route('/', FileRoutes);
  return app.request(path, { method });
};

describe('DELETE /files/:id', () => {
  it('answers with the deleted file id inside the success envelope', async () => {
    const res = await request('/file-1', 'DELETE');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ deleted: true, id: 'file-1' });
    expect(() => successEnvelope(DeletedResourceSchema).parse(body)).not.toThrow();
  });
});
