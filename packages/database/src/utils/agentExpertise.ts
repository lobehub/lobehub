import { and, count, countDistinct, eq, inArray, isNull, not, notInArray, or } from 'drizzle-orm';

import { expertiseBindings, expertiseDomains } from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspaceWhere } from './workspace';

interface AgentExpertiseHandoverParams {
  agentIds: string[];
  /** The member the agent(s) are being re-homed to — visibility is judged as THEM. */
  recipientId: string;
  workspaceId: string;
}

type Db = LobeChatDatabase | Transaction;

/**
 * Domains bound to these agents that the recipient cannot see (private to
 * another member) — the exact reads `listDomainsForAgent` will run once the
 * recipient owns the agent.
 */
const inaccessibleBoundDomains = (params: AgentExpertiseHandoverParams) =>
  and(
    inArray(expertiseBindings.agentId, params.agentIds),
    not(
      buildWorkspaceWhere(
        { userId: params.recipientId, workspaceId: params.workspaceId },
        expertiseDomains,
      ),
    ),
  );

/**
 * Expertise policy for an ownership handover. An agent's learned expertise —
 * typically the PRIVATE domain seeded with the agent — resolves through the
 * viewer's visibility filter, so after a bare owner flip the transferred agent
 * silently loses it. Instead:
 *
 * - A domain bound ONLY to the transferred agents is that agent's own learned
 *   expertise: it re-homes to the recipient and keeps working.
 * - A domain also bound elsewhere (the previous owner's other agents, project
 *   or member-level bindings) stays with its owner; the transferred agents'
 *   bindings are removed EXPLICITLY rather than left as invisible holes.
 *
 * The manifest surfaces the affected-domain count to both parties.
 */
export const rehomeAgentExpertiseForRecipient = async (
  db: Db,
  params: AgentExpertiseHandoverParams,
): Promise<void> => {
  if (params.agentIds.length === 0) return;

  const domainRows = await db
    .selectDistinct({ id: expertiseDomains.id })
    .from(expertiseBindings)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
    .where(inaccessibleBoundDomains(params));

  for (const domain of domainRows) {
    const [outside] = await db
      .select({ value: count() })
      .from(expertiseBindings)
      .where(
        and(
          eq(expertiseBindings.domainId, domain.id),
          or(
            isNull(expertiseBindings.agentId),
            notInArray(expertiseBindings.agentId, params.agentIds),
          ),
        ),
      );
    if (outside.value === 0) {
      await db
        .update(expertiseDomains)
        .set({ userId: params.recipientId })
        .where(eq(expertiseDomains.id, domain.id));
    } else {
      await db
        .delete(expertiseBindings)
        .where(
          and(
            eq(expertiseBindings.domainId, domain.id),
            inArray(expertiseBindings.agentId, params.agentIds),
          ),
        );
    }
  }
};

/**
 * Read-only companion for the transfer manifest: how many domains the handover
 * above will re-home or unbind. Must stay predicate-identical to it.
 */
export const countAgentExpertiseAffected = async (
  db: Db,
  params: AgentExpertiseHandoverParams,
): Promise<number> => {
  if (params.agentIds.length === 0) return 0;
  const [row] = await db
    .select({ value: countDistinct(expertiseDomains.id) })
    .from(expertiseBindings)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
    .where(inaccessibleBoundDomains(params));
  return row.value;
};
