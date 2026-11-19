import type { Context } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';

import { BaseController } from './base.controller';
import { ApiErrorSchema, ApiException } from './errors';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));

class TestController extends BaseController {
  respond(c: Context, error: Error) {
    return this.handleError(c, error);
  }
}

const requestThrown = async (error: Error) => {
  const app = new Hono();
  app.get('/', (c) => new TestController().respond(c, error));
  return app.request('/');
};

const requestError = async (name: string) => {
  const error = new Error('test error');
  error.name = name;
  return requestThrown(error);
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

  it.each([
    ['BusinessError', 'bad_request'],
    ['ValidationError', 'validation_error'],
    ['AuthenticationError', 'unauthorized'],
    ['AuthorizationError', 'forbidden'],
    ['NotFoundError', 'not_found'],
    ['ConflictError', 'conflict'],
    ['Error', 'internal_error'],
  ])('answers %s with the %s catalogue code in the shared ApiError shape', async (name, code) => {
    const body = await (await requestError(name)).json();
    expect(ApiErrorSchema.parse(body)).toMatchObject({
      code,
      error: 'test error',
      message: 'test error',
    });
  });

  it('maps a tRPC refusal to its status and code', async () => {
    const error = Object.assign(new Error('agent missing'), {
      code: 'NOT_FOUND',
      name: 'TRPCError',
    });
    const response = await requestThrown(error);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'not_found' });
  });

  it('keeps the code and details an ApiException carries', async () => {
    const response = await requestThrown(
      new ApiException(403, 'workspace_mismatch', 'wrong workspace', [
        { message: 'mismatch', path: 'header.X-Workspace-Id' },
      ]),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'workspace_mismatch',
      details: [{ path: 'header.X-Workspace-Id' }],
    });
  });

  it('reads an insufficient_scope refusal from its message prefix', async () => {
    const response = await requestThrown(
      new HTTPException(403, { message: "insufficient_scope: missing 'agent:read'" }),
    );
    await expect(response.json()).resolves.toMatchObject({ code: 'insufficient_scope' });
  });
});
