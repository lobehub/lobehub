import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { userConnectors } from '@/database/schemas';

import { personalConnectorCallback } from './callback';

const app = new Hono().basePath('/api/connectors');
app.get(
  '/oauth/callback',
  personalConnectorCallback(async (id, session) => {
    const db = await getServerDB();
    const [row] = await db
      .select({ metadata: userConnectors.metadata })
      .from(userConnectors)
      .where(
        and(
          eq(userConnectors.id, id),
          isNull(userConnectors.workspaceId),
          sql`${userConnectors.metadata} #>> '{personalConnection,authorization,id}' = ${session}`,
        ),
      )
      .limit(1);
    const authorization = (
      row?.metadata?.personalConnection as
        { authorization?: { id: string; expiresAt: number } } | undefined
    )?.authorization;
    return authorization
      ? { id, session: authorization.id, expiresAt: authorization.expiresAt }
      : null;
  }),
);
export default app;
