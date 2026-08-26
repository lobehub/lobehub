import { isHeterogeneousAgentConfig } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, ne } from 'drizzle-orm';

import { agents, agentShares } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface HeterogeneityCheckInput {
  agencyConfig?: LobeAgentAgencyConfig | null;
  model?: string | null;
}

interface WriteAgentConfigWithShareResetParams {
  /** Agent ID whose `agentShares` row (if any) must be reset. */
  agentId: string;
  /** Post-merge `model` / `agencyConfig` that the write is about to persist. */
  resultingConfig: HeterogeneityCheckInput;
  /** Whether this write touches `model` or `agencyConfig` — skip the heterogeneity check otherwise, so a plain title/plugin/etc. update never pays for the extra query. */
  touchesHeterogeneityFields: boolean;
  /** Columns to write to `agents`. */
  updateData: Record<string, unknown>;
  /** Row-lock + write predicate, e.g. `and(eq(agents.id, agentId), ownership)`. Must uniquely match the target agent row. */
  where: SQL;
}

/**
 * Lock the agent row, write the given column patch, and reset any non-private
 * share back to `private` if the write makes the config heterogeneous.
 *
 * This is the single choke point for the invariant "an agent's `link` share
 * must never survive a write that turns its config heterogeneous" (e.g.
 * switching to Codex / Claude Code — see `isHeterogeneousAgentConfig`).
 * `AiAgentService` fail-closes every visitor run against a heterogeneous
 * share (`ShareHeterogeneousAgentUnsupported`), but that gate only runs at
 * share-time — it never re-checks a share that was already public when the
 * underlying agent config changes later. Without this reset, the owner's
 * Share tab silently disappears while existing recipients keep hitting a
 * live-looking link whose every send fails.
 *
 * EVERY writer of `agents.model` / `agents.agencyConfig` MUST route through
 * this helper instead of duplicating the lock + reset SQL inline. Known
 * callers:
 * - `AgentModel.updateConfig` (packages/database/src/models/agent.ts) — chat
 *   client and the agent-builder tool.
 * - `AgentService.updateAgent`
 *   (packages/openapi/src/services/agent.service.ts) — `PATCH
 *   /api/v1/agents/:id`. This endpoint used to write `agents` directly with
 *   `tx.update(agents)`, bypassing `updateConfig` (and this reset) entirely,
 *   so a published homogeneous agent could be flipped to a heterogeneous
 *   model over the OpenAPI while its share stayed `link`. See LOBE-11930.
 *
 * `AgentShareModel.updateVisibility` (packages/database/src/models/
 * agentShare.ts) takes the SAME row lock (`agents.id = agentId` FOR UPDATE)
 * before publishing a share to `link`, so whichever of the two writers wins
 * the row lock decides the outcome and the other observes its committed
 * result instead of interleaving.
 */
export async function writeAgentConfigWithShareReset(
  db: LobeChatDatabase,
  params: WriteAgentConfigWithShareResetParams,
) {
  const { agentId, resultingConfig, touchesHeterogeneityFields, updateData, where } = params;

  const mayNeedShareReset =
    touchesHeterogeneityFields && isHeterogeneousAgentConfig(resultingConfig);

  return db.transaction(async (trx) => {
    await trx.select({ id: agents.id }).from(agents).where(where).for('update');

    const [updated] = await trx.update(agents).set(updateData).where(where).returning();

    if (mayNeedShareReset) {
      await trx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility: 'private' })
        .where(and(eq(agentShares.agentId, agentId), ne(agentShares.visibility, 'private')));
    }

    return updated ?? null;
  });
}
