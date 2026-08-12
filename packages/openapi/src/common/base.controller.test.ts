import type { Context } from 'hono';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { BaseController } from './base.controller';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));

class TestController extends BaseController {
  respond(c: Context, error: Error) {
    return this.handleError(c, error);
  }
}

const requestError = async (name: string) => {
  const app = new Hono();
  app.get('/', (c) => {
    const error = new Error('test error');
    error.name = name;
    return new TestController().respond(c, error);
  });
  return app.request('/');
};

describe('BaseController.handleError', () => {
  it.each([
    ['BusinessError', 400],
    ['ValidationError', 400],
    ['AuthenticationError', 401],
    ['AuthorizationError', 403],
    ['NotFoundError', 404],
    ['ConflictError', 409],
  ])('maps %s to HTTP %i', async (name, status) => {
    const response = await requestError(name as string);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: 'test error', success: false });
  });
});
