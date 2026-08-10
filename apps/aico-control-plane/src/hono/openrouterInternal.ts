import { Hono } from 'hono';

import { createOpenRouterManagementClient } from '@/server/services/openrouter/management';

import { assertBearerServiceToken } from './serviceToken';

const unauthorized = () =>
  new Response(JSON.stringify({ error: 'unauthorized' }), {
    headers: { 'Content-Type': 'application/json' },
    status: 401,
  });

/**
 * Token-gated OpenRouter Management API proxy for the product server.
 * Path prefix: /internal/openrouter/v1/keys
 */
export const createOpenRouterInternalApp = () => {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (!assertBearerServiceToken(c.req.raw)) return unauthorized();
    return next();
  });

  app.post('/', async (c) => {
    const body = (await c.req.json()) as {
      limit?: number;
      limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
      name?: string;
    };
    const client = createOpenRouterManagementClient({
      managementKey: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    });
    const created = await client.createKey({
      limitReset: body.limit_reset ?? null,
      limitUsd: Number(body.limit ?? 0),
      name: String(body.name ?? 'aico'),
    });
    // Match OpenRouter create response shape expected by parseCreateKeyResponse.
    return c.json({
      data: {
        disabled: created.disabled,
        hash: created.hash,
        limit: created.limit,
        limit_remaining: created.limitRemaining,
        name: created.name,
        usage: created.usage,
      },
      key: created.key,
    });
  });

  app.get('/:hash', async (c) => {
    const client = createOpenRouterManagementClient({
      managementKey: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    });
    const info = await client.getKey(c.req.param('hash'));
    return c.json({
      data: {
        disabled: info.disabled,
        hash: info.hash,
        limit: info.limit,
        limit_remaining: info.limitRemaining,
        name: info.name,
        usage: info.usage,
      },
    });
  });

  app.patch('/:hash', async (c) => {
    const body = (await c.req.json()) as {
      disabled?: boolean;
      limit?: number;
      limit_reset?: 'daily' | 'weekly' | 'monthly' | null;
      name?: string;
    };
    const client = createOpenRouterManagementClient({
      managementKey: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    });
    const info = await client.updateKey({
      disabled: body.disabled,
      hash: c.req.param('hash'),
      limitReset: body.limit_reset,
      limitUsd: body.limit,
      name: body.name,
    });
    return c.json({
      data: {
        disabled: info.disabled,
        hash: info.hash,
        limit: info.limit,
        limit_remaining: info.limitRemaining,
        name: info.name,
        usage: info.usage,
      },
    });
  });

  app.delete('/:hash', async (c) => {
    const client = createOpenRouterManagementClient({
      managementKey: process.env.OPENROUTER_MANAGEMENT_API_KEY,
    });
    await client.deleteKey(c.req.param('hash'));
    return c.body(null, 204);
  });

  return app;
};
