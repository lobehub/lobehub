import { hashApiKey } from '@lobechat/utils/server';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { apiKeys, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { errorInitFromException, renderApiError } from '../../common/errors';
import { userAuthMiddleware } from '../../middleware/auth';
import { workspaceAuthMiddleware } from '../../middleware/workspace';

/**
 * Real-HTTP route harness for PGlite tests: the routes behind the same auth and
 * workspace middlewares as `app.ts`, with real `api_keys` rows. The calling
 * test file must point `getServerDB` at the PGlite handle (`vi.mock` of
 * `@/database/core/db-adaptor`), since mocks are hoisted per file.
 */
export const buildRouteApp = (routes: Record<string, Hono>) => {
  const app = new Hono().basePath('/api/v1');
  app.onError((error, c) =>
    error instanceof HTTPException
      ? renderApiError(c, errorInitFromException(error))
      : renderApiError(c, { message: error.message, status: 500 }),
  );
  app.use('*', userAuthMiddleware);
  app.use('*', workspaceAuthMiddleware);
  for (const [path, route] of Object.entries(routes)) app.route(`/${path}`, route);

  return {
    call: (
      path: string,
      init: {
        body?: unknown;
        headers?: Record<string, string>;
        key?: string;
        method?: string;
      } = {},
    ) =>
      app.request(`/api/v1${path}`, {
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        headers: {
          ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
          'content-type': 'application/json',
          ...init.headers,
        },
        method: init.method ?? 'GET',
      }),
  };
};

export const json = async (res: Response) => (await res.json()) as any;

/** Insert users and one API key per `[key, userId, scopes]` entry. */
export const seedUsersAndKeys = async (
  db: LobeChatDatabase,
  userIds: string[],
  keys: [key: string, userId: string, scopes: string[] | null][],
) => {
  await db.insert(users).values(userIds.map((id) => ({ id })));
  await db.insert(apiKeys).values(
    keys.map(([key, userId, scopes]) => ({
      key,
      keyHash: hashApiKey(key),
      name: key,
      scopes,
      userId,
    })),
  );
};
