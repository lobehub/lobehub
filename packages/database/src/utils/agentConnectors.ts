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
 * Connector policy for a CROSS-SCOPE transfer (personal ↔ workspace): the
 * agent-owned connector rows are the agent's own configuration and must ride
 * along, or every custom plugin the agent carries silently stops resolving —
 * ConnectorModel's ownership predicate is scope-exact, so a row left with the
 * source `workspace_id` is invisible from the target scope.
 *
 * Credential policy mirrors {@link rehomeAgentConnectorsForRecipient}: when
 * the target owner is the row's owner (the common case — a user moving their
 * own agent), credentials travel untouched and the plugin keeps working;
 * when ownership changes, the row is first stripped to a disconnected
 * reauthorization shell by the handover helper above. Base rows of OTHER
 * scopes mounted by the agent (`metadata.mountedByAgentId`) unmount — a mount
 * cannot resolve across scopes, so keeping the marker would only misreport
 * the base row as linked to an agent it can no longer serve.
 */
export const rehomeAgentConnectorsForScopeTransfer = async (
  db: Db,
  params: {
    agentIds: string[];
    targetUserId: string;
    targetWorkspaceId: string | null;
  },
): Promise<void> => {
  const { agentIds, targetUserId, targetWorkspaceId } = params;
  if (agentIds.length === 0) return;

  // Foreign-owned agent rows lose their credentials exactly like a member
  // handover — the previous owner's OAuth identity never follows an agent to
  // a new owner. Also unmounts foreign members' mounted base rows.
  await rehomeAgentConnectorsForRecipient(db, { agentIds, recipientId: targetUserId });

  // Every agent-scoped row (wiped shells above + the target owner's own rows,
  // credentials intact) now moves to the target scope with the agent.
  const scopedRows = await db
    .update(userConnectors)
    .set({ userId: targetUserId, workspaceId: targetWorkspaceId })
    .where(inArray(userConnectors.agentId, agentIds))
    .returning({ id: userConnectors.id });

  if (scopedRows.length > 0) {
    // Tool rows denormalize scope from their parent connector — left behind
    // they'd vanish from scope-filtered reads (and cascade away with the
    // previous owner's account).
    await db
      .update(userConnectorTools)
      .set({ userId: targetUserId, workspaceId: targetWorkspaceId })
      .where(
        inArray(
          userConnectorTools.userConnectorId,
          scopedRows.map((row) => row.id),
        ),
      );
  }

  // The handover helper only unmounts OTHER members' base rows; the moving
  // owner's own mounted base rows stay in the source scope and are just as
  // unreachable from the target — unmount those too.
  await db
    .update(userConnectors)
    .set({ metadata: sql`${userConnectors.metadata} - 'mountedByAgentId'` })
    .where(inArray(sql`${userConnectors.metadata} ->> 'mountedByAgentId'`, agentIds));
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
