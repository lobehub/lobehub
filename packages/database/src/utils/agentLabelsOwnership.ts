import { and, count, eq, inArray, notInArray } from 'drizzle-orm';

import { agentLabelAssignments, agentLabels } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';

interface AgentLabelsHandoverParams {
  agentIds: string[];
  fromUserId: string;
  recipientId: string;
}

/**
 * Label policy for an ownership handover. Both tables cascade on user
 * deletion, so rows left attributed to the previous owner would strip the
 * transferred agent's labels if that account is later deleted:
 *
 * - Assignment rows of the previous owner re-home to the recipient (unique
 *   per (label, agent) — the user column is attribution only).
 * - A backing label the previous owner created re-homes too when the
 *   transferred agents are its ONLY assignees (workspace label names are
 *   unique per workspace, not per user, so the flip cannot collide). A label
 *   also assigned to other agents stays with its creator: it is shared
 *   workspace taxonomy whose coupling to that member's account lifetime
 *   predates this transfer.
 */
export const rehomeAgentLabelsForRecipient = async (
  db: LobeChatDatabase | Transaction,
  params: AgentLabelsHandoverParams,
): Promise<void> => {
  const { agentIds, fromUserId, recipientId } = params;
  if (agentIds.length === 0) return;

  await db
    .update(agentLabelAssignments)
    .set({ userId: recipientId })
    .where(
      and(
        inArray(agentLabelAssignments.agentId, agentIds),
        eq(agentLabelAssignments.userId, fromUserId),
      ),
    );

  const labelRows = await db
    .selectDistinct({ id: agentLabels.id })
    .from(agentLabels)
    .innerJoin(agentLabelAssignments, eq(agentLabelAssignments.labelId, agentLabels.id))
    .where(
      and(inArray(agentLabelAssignments.agentId, agentIds), eq(agentLabels.userId, fromUserId)),
    );
  for (const label of labelRows) {
    const [outside] = await db
      .select({ value: count() })
      .from(agentLabelAssignments)
      .where(
        and(
          eq(agentLabelAssignments.labelId, label.id),
          notInArray(agentLabelAssignments.agentId, agentIds),
        ),
      );
    if (outside.value === 0) {
      await db.update(agentLabels).set({ userId: recipientId }).where(eq(agentLabels.id, label.id));
    }
  }
};
