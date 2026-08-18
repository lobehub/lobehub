import { and, count, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { userConnectors, userConnectorTools } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

interface AgentConnectorHandoverParams {
  agentIds: string[];
  /** The member the agent(s) are being re-homed to. */
  recipientId: string;
}

type Db = LobeChatDatabase | Transaction;

/** Agent-OWNED connector rows on these agents attributed to someone other than the recipient. */
const foreignAgentScopedRows = (params: AgentConnectorHandoverParams) =>
  and(
    inArray(userConnectors.agentId, params.agentIds),
    ne(userConnectors.userId, params.recipientId),
  );

/** Base rows another member owns that are MOUNTED by these agents (the Linked flow). */
const foreignMountedRows = (params: AgentConnectorHandoverParams) =>
  and(
    inArray(sql`${userConnectors.metadata} ->> 'mountedByAgentId'`, params.agentIds),
    ne(userConnectors.userId, params.recipientId),
  );

/**
 * Connector policy for an ownership handover. OAuth / Composio credentials are
 * the connecting MEMBER's personal identity, so unlike bot tokens they never
 * travel — but the previous owner also loses the standing to manage rows on an
 * agent that is no longer theirs (and their account deletion would cascade the
 * rows away under the recipient's feet):
 *
 * - Agent-OWNED rows (`agent_id` set, Copy / Connect-new) re-home to the
 *   recipient as a configuration shell — credentials wiped, `disconnected`,
 *   disabled — so the recipient keeps the connector setup but must authorize
 *   with their OWN account before anything runs.
 * - Base rows of OTHER members mounted by the agent (`metadata.
 *   mountedByAgentId`, the Linked flow) simply unmount: the row is that
 *   member's personal connector and stays theirs, untouched otherwise.
 *
 * The manifest surfaces the combined count to both parties before acceptance.
 */
export const rehomeAgentConnectorsForRecipient = async (
  db: Db,
  params: AgentConnectorHandoverParams,
): Promise<void> => {
  if (params.agentIds.length === 0) return;

  const scopedRows = await db
    .select({ id: userConnectors.id, metadata: userConnectors.metadata })
    .from(userConnectors)
    .where(foreignAgentScopedRows(params));
  for (const row of scopedRows) {
    // The Composio ACCOUNT fields go with the credentials: a retained
    // `connectedAccountId` would let the recipient's delete/re-enable paths
    // operate on the previous owner's remote Composio connection. Config
    // fields (`appSlug`, `authConfigId`) stay so reauthorization can reuse
    // the connector's setup.
    let metadata = row.metadata;
    if (metadata?.composio) {
      const composio = { ...metadata.composio, status: 'PENDING' };
      delete (composio as Partial<typeof composio>).connectedAccountId;
      delete composio.linkedByUserId;
      delete composio.redirectUrl;
      metadata = { ...metadata, composio };
    }
    await db
      .update(userConnectors)
      .set({
        credentials: null,
        isEnabled: false,
        metadata,
        status: 'disconnected',
        tokenExpiresAt: null,
        userId: params.recipientId,
      })
      .where(eq(userConnectors.id, row.id));
  }
  if (scopedRows.length > 0) {
    // The synced tool rows denormalize `user_id` from their parent connector
    // and cascade on user deletion — left behind, the previous owner's
    // account deletion would strip the transferred shell's tool definitions.
    await db
      .update(userConnectorTools)
      .set({ userId: params.recipientId })
      .where(
        inArray(
          userConnectorTools.userConnectorId,
          scopedRows.map((row) => row.id),
        ),
      );
  }

  await db
    .update(userConnectors)
    .set({ metadata: sql`${userConnectors.metadata} - 'mountedByAgentId'` })
    .where(foreignMountedRows(params));
};

/**
 * Read-only companion for the transfer manifest: how many connectors the
 * handover above will disconnect (agent-owned reauthorization shells) or
 * unmount (other members' linked rows). Must stay predicate-identical to it.
 */
export const countAgentConnectorsAffected = async (
  db: Db,
  params: AgentConnectorHandoverParams,
): Promise<number> => {
  if (params.agentIds.length === 0) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(userConnectors)
    .where(or(foreignAgentScopedRows(params), foreignMountedRows(params)));
  return row.value;
};
