import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import DocumentRoutes from './documents.route';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = async () => true;
  },
}));
vi.mock('../middleware/auth', () => ({
  requireAuth: async (_c: Context, next: () => Promise<void>) => next(),
}));
vi.mock('../controllers/document.controller', () => ({
  DocumentController: class {
    createDocument(c: Context) {
      return c.json({ data: { id: 'doc-1' }, success: true }, 201);
    }
    getDocument(c: Context) {
      return c.json({ data: { id: 'doc-1' }, success: true });
    }
    listDocuments(c: Context) {
      return c.json({ data: { items: [] }, success: true });
    }
    updateDocument(c: Context) {
      return c.json({ data: { id: 'doc-1' }, success: true });
    }
  },
}));

const requestAs = (scopes: string[], path: string, init?: { body?: unknown; method?: string }) => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('userId' as never, 'user-1' as never);
    c.set('authType' as never, 'apikey' as never);
    c.set('apiKeyScopes' as never, scopes as never);
    await next();
  });
  app.route('/', DocumentRoutes);

  return app.request(path, {
    ...(init?.body === undefined
      ? {}
      : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
    method: init?.method ?? 'GET',
  });
};

describe('POST /documents', () => {
  it('creates a page for a key that may write knowledge', async () => {
    const res = await requestAs(['knowledge:write'], '/', {
      body: { content: '# Weekly sync', title: 'Weekly sync' },
      method: 'POST',
    });

    expect(res.status).toBe(201);
  });

  it('creates a folder inside a folder', async () => {
    const res = await requestAs(['knowledge:write'], '/', {
      body: { fileType: 'custom/folder', parentId: 'docs_root', title: 'Meeting minutes' },
      method: 'POST',
    });

    expect(res.status).toBe(201);
  });

  it('rejects a read-only key', async () => {
    const res = await requestAs(['knowledge:read'], '/', {
      body: { title: 'Weekly sync' },
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });

  it('rejects a document without a title', async () => {
    const res = await requestAs(['knowledge:write'], '/', {
      body: { content: 'body only' },
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });

  it('rejects fields the API does not open, such as visibility', async () => {
    const res = await requestAs(['knowledge:write'], '/', {
      body: { title: 'Weekly sync', visibility: 'public' },
      method: 'POST',
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /documents/:id', () => {
  it('replaces the title and body', async () => {
    const res = await requestAs(['knowledge:write'], '/doc-1', {
      body: { content: '# New body', title: 'Weekly sync' },
      method: 'PATCH',
    });

    expect(res.status).toBe(200);
  });

  it('rejects an empty update', async () => {
    const res = await requestAs(['knowledge:write'], '/doc-1', { body: {}, method: 'PATCH' });

    expect(res.status).toBe(400);
  });

  it('rejects a read-only key', async () => {
    const res = await requestAs(['knowledge:read'], '/doc-1', {
      body: { title: 'Weekly sync' },
      method: 'PATCH',
    });

    expect(res.status).toBe(403);
  });
});

describe('GET /documents', () => {
  it('lists the children of a folder for a read key', async () => {
    const res = await requestAs(['knowledge:read'], '/?parentId=folder-1&limit=20');

    expect(res.status).toBe(200);
  });

  it('rejects a key that holds no knowledge scope', async () => {
    const res = await requestAs(['chat:read'], '/doc-1');

    expect(res.status).toBe(403);
  });

  it('rejects a page size over 100', async () => {
    const res = await requestAs(['knowledge:read'], '/?limit=500');

    expect(res.status).toBe(400);
  });
});
