import { and, count, eq, or, sql } from 'drizzle-orm';

import { userConnectors } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * How many private connectors in the workspace serve `agentId`: the agent's own
 * rows, and base rows mounted on it (`metadata.mountedByAgentId`). A private
 * connector serves only its creator's private agents, and run scoping drops it
 * from a shared agent — so while any exists, publishing the agent would leave
 * its configured tool unavailable, or silently answer it with a shared
 * connector of the same identifier running another account.
 */
export const countPrivateConnectorBindings = async (
  db: LobeChatDatabase,
  workspaceId: string,
  agentId: string,
): Promise<number> => {
  const [row] = await db
    .select({ value: count() })
    .from(userConnectors)
    .where(
      and(
        eq(userConnectors.workspaceId, workspaceId),
        eq(userConnectors.visibility, 'private'),
        or(
          eq(userConnectors.agentId, agentId),
          sql`${userConnectors.metadata} ->> 'mountedByAgentId' = ${agentId}`,
        ),
      ),
    );
  return Number(row?.value ?? 0);
};
