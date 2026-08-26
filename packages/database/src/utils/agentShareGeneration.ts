import { eq, sql } from 'drizzle-orm';

import { agentShareGenerations } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Bump (and durably persist) the monotonic restrictive-change generation
 * counter for an agent's share. MUST be called inside the SAME `agents.id
 * FOR UPDATE` transaction the caller already holds
 * (`AgentShareModel.withOwnedPersonalAgentLock` / the lock
 * `writeAgentConfigWithShareReset` takes itself) — every writer of this
 * counter and every reader of it (`assertRunnableForVisitor`) goes through
 * that SAME physical row lock, which is what makes "read current generation,
 * compare, stake a reservation at it" and "bump generation, capture the new
 * value as a revocation cutoff" strictly ordered instead of racing. See
 * `agentShareGenerations`'s JSDoc (`../schemas/agentShare.ts`) for why this
 * lives in its own table and LOBE-11930.
 *
 * Upsert, not a plain `UPDATE`: the counter row may not exist yet (no
 * restrictive change has ever happened for this agent), in which case the
 * implicit baseline is `1` (see `readAgentShareGeneration`) and the first
 * bump must land on `2`.
 */
export const bumpAgentShareGeneration = async (
  tx: LobeChatDatabase,
  agentId: string,
): Promise<number> => {
  const [row] = await tx
    .insert(agentShareGenerations)
    .values({ agentId, generation: 2 })
    .onConflictDoUpdate({
      set: { generation: sql`${agentShareGenerations.generation} + 1`, updatedAt: new Date() },
      target: agentShareGenerations.agentId,
    })
    .returning({ generation: agentShareGenerations.generation });

  return row.generation;
};

/**
 * Read the current generation WITHOUT bumping it, defaulting to the baseline
 * `1` for an agent whose share has never had a restrictive change. Same
 * locking requirement as {@link bumpAgentShareGeneration}.
 */
export const readAgentShareGeneration = async (
  tx: LobeChatDatabase,
  agentId: string,
): Promise<number> => {
  const [row] = await tx
    .select({ generation: agentShareGenerations.generation })
    .from(agentShareGenerations)
    .where(eq(agentShareGenerations.agentId, agentId));

  return row?.generation ?? 1;
};
