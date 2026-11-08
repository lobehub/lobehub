import type { MiddlewareHandler } from 'hono';

import { validateInternalJWT } from '@/libs/trpc/utils/internalJwt';

import { qstashAuth } from './qstashAuth';

/** Accept only QStash or the server's internal-call signature, never a user or device grant. */
export const mcpQueueAuth = (): MiddlewareHandler => async (c, next) => {
  const token = c.req.header('X-Lobe-Mcp-Internal');
  if (token && (await validateInternalJWT(token))) return next();
  return qstashAuth()(c, next);
};
