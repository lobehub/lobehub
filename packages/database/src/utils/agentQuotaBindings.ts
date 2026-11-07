import { and, count, eq, inArray, notInArray } from 'drizzle-orm';

import { agentAccountBindings, agentProviderAccounts } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

interface AgentQuotaHandoverParams {
  agentIds: string[];
  fromUserId: string;
  recipientId: string;
}

type Db = LobeChatDatabase | Transaction;

/**
 * Quota policy for an ownership handover. Both tables cascade on user
 * deletion, so rows left attributed to the previous owner would silently
 * strip the transferred agent's account selection if that account is later
 * deleted:
 *
 * - `agent_account_bindings` rows of the previous owner re-home to the
 *   recipient, still ENABLED — the user column is attribution only; a binding
 *   selects a workspace quota account and runs nothing under the previous
 *   owner's identity.
 * - An `agent_provider_accounts` row the previous owner observed re-homes too
 *   when the transferred agents are its ONLY consumers (the workspace
 *   identity uniqueness is deliberately not keyed on userId, so the flip
 *   cannot collide). An account also serving other agents stays with its
 *   observer: it is shared workspace capacity, and its coupling to that
 *   member's account lifetime is a workspace-wide property that predates and
 *   outlives this transfer.
 */
export const rehomeAgentQuotaBindingsForRecipient = async (
  db: Db,
  params: AgentQuotaHandoverParams,
): Promise<void> => {
  const { agentIds, fromUserId, recipientId } = params;
  if (agentIds.length === 0) return;

  await db
    .update(agentAccountBindings)
    .set({ updatedAt: agentAccountBindings.updatedAt, userId: recipientId })
    .where(
      and(
        inArray(agentAccountBindings.agentId, agentIds),
        eq(agentAccountBindings.userId, fromUserId),
      ),
    );

  const accountRows = await db
    .selectDistinct({ id: agentProviderAccounts.id })
    .from(agentProviderAccounts)
    .innerJoin(agentAccountBindings, eq(agentAccountBindings.accountId, agentProviderAccounts.id))
    .where(
      and(
        inArray(agentAccountBindings.agentId, agentIds),
        eq(agentProviderAccounts.userId, fromUserId),
      ),
    );
  for (const account of accountRows) {
    const [outside] = await db
      .select({ value: count() })
      .from(agentAccountBindings)
      .where(
        and(
          eq(agentAccountBindings.accountId, account.id),
          notInArray(agentAccountBindings.agentId, agentIds),
        ),
      );
    if (outside.value === 0) {
      await db
        .update(agentProviderAccounts)
        .set({ updatedAt: agentProviderAccounts.updatedAt, userId: recipientId })
        .where(eq(agentProviderAccounts.id, account.id));
    }
  }
};
