import type { MiddlewareHandler } from 'hono';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

/**
 * Shared header guard for the memory webhook receivers.
 *
 * `MEMORY_USER_MEMORY_WEBHOOK_HEADERS` configures a set of static
 * `header: value` pairs that every caller must present. When no headers are
 * configured the guard is a no-op, matching the previous per-route behavior.
 */
export const memoryWebhookAuth = (): MiddlewareHandler => async (c, next) => {
  const { webhook } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      if (c.req.header(key) !== value) {
        return c.json({ error: `Unauthorized: Missing or invalid header '${key}'` }, 403);
      }
    }
  }

  await next();
};
