import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import { userConnectors } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { withNativeConnectorLock } from '@/libs/mcp/nativeConnectorLock';

import type { PersonalConnection } from './index';

/** Never revoke a shared provider credential as if it belonged only to this row. */
export const guardComposioRevocation = async (
  db: LobeChatDatabase,
  userId: string,
  connection: PersonalConnection,
  remove: () => Promise<void>,
) =>
  withNativeConnectorLock(db, userId, connection.providerId, async (tx) => {
    const [current] = await tx
      .select()
      .from(userConnectors)
      .where(
        and(
          eq(userConnectors.id, connection.id),
          eq(userConnectors.userId, userId),
          isNull(userConnectors.workspaceId),
        ),
      )
      .limit(1)
      .for('share');
    if (
      !current ||
      current.updatedAt.getTime() !== connection.revision ||
      current.isEnabled ||
      current.metadata?.composio?.connectedAccountId !== connection.remoteId
    )
      throw new Error('The stopped connection changed before revocation');
    const [other] = await tx
      .select({ id: userConnectors.id })
      .from(userConnectors)
      .where(
        and(
          ne(userConnectors.id, connection.id),
          sql`${userConnectors.metadata} #>> '{composio,connectedAccountId}' = ${connection.remoteId}`,
        ),
      )
      .limit(1);
    if (other)
      throw Object.assign(new Error('Other connections still reference this account'), {
        code: 'CONNECTION_SHARED',
      });
    await remove();
  });
