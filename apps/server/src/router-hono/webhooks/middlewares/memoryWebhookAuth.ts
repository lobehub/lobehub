import type { MiddlewareHandler } from 'hono';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

/**
 * Shared header guard for the memory webhook receivers.
 *
 * `MEMORY_USER_MEMORY_WEBHOOK_HEADERS` configures a set of static
 * `header: value` pairs that every caller must present. Reject requests when
 * authentication is not configured rather than exposing the memory pipeline.
 */
export const memoryWebhookAuth = (): MiddlewareHandler => async (c, next) => {
  const { webhook } = parseMemoryExtractionConfig();

  if (!webhook.headers || Object.keys(webhook.headers).length === 0) {
    return c.json(
      {
        error:
          'Memory webhook authentication is not configured. Set MEMORY_USER_MEMORY_WEBHOOK_HEADERS.',
      },
      503,
    );
  }

  for (const [key, value] of Object.entries(webhook.headers)) {
    if (c.req.header(key) !== value) {
      return c.json({ error: `Unauthorized: Missing or invalid header '${key}'` }, 403);
    }
  }

  await next();
};
