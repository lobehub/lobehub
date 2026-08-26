import { isHeterogeneousAgentConfig } from '@lobechat/const';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, ne } from 'drizzle-orm';

import { agents, agentShares } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { bumpAgentShareGeneration } from './agentShareGeneration';

interface HeterogeneityCheckInput {
  agencyConfig?: LobeAgentAgencyConfig | null;
  model?: string | null;
}

interface WriteAgentConfigWithShareResetParams {
  /** Agent ID whose `agentShares` row (if any) must be reset. */
  agentId: string;
  /**
   * Invoked synchronously, AFTER this function's transaction has already
   * committed, but ONLY when the write actually flipped a non-private share
   * back to `private` (not merely "was heterogeneous enough to check" —
   * `mayNeedShareReset` alone does not imply a row changed, e.g. the share
   * was already `private` or didn't exist).
   *
   * WHY this hook exists: this function only flips `agentShares.visibility`.
   * It does NOT stop an operation that is already running against the OLD
   * (now-invalid) config snapshot under the creator's credentials/budget —
   * that requires `AiAgentService.interruptActiveShareRuns`, which lives in
   * `apps/server` and this package (`packages/database`) cannot import. Every
   * caller that CAN reach the server layer (a tRPC procedure, a tool
   * executor, an OpenAPI controller) MUST pass a callback here that schedules
   * that interrupt (typically via `after()`), mirroring what
   * `agentShareRouter.disableShare` / `updateVisibility` already do for
   * explicit revocation. See LOBE-11930 hole 2.
   *
   * `revocationGeneration` is the EXACT value this function itself just
   * bumped `agentShareGenerations` to as part of the SAME transaction as the
   * reset — pass it straight through to `interruptActiveShareRuns`, never a
   * value re-read at callback time. See `agentShareGenerations`'s JSDoc
   * (`../schemas/agentShare.ts`) and that method's JSDoc for why.
   */
  onShareReset?: (agentId: string, revocationGeneration: number) => void;
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
  const { agentId, onShareReset, resultingConfig, touchesHeterogeneityFields, updateData, where } =
    params;

  const mayNeedShareReset =
    touchesHeterogeneityFields && isHeterogeneousAgentConfig(resultingConfig);

  const { didResetShare, revocationGeneration, updated } = await db.transaction(async (trx) => {
    await trx.select({ id: agents.id }).from(agents).where(where).for('update');

    const [updated] = await trx.update(agents).set(updateData).where(where).returning();

    let didResetShare = false;
    let revocationGeneration: number | undefined;
    if (mayNeedShareReset) {
      // `.returning()` here is load-bearing, not cosmetic: `mayNeedShareReset`
      // is only a possibility check (the new config is heterogeneous), it does
      // NOT mean a row actually flipped — the share may already be `private`
      // or not exist at all. `onShareReset` must fire only on an ACTUAL
      // transition, so a caller's post-commit interrupt never fires (and pays
      // its DB round-trip) for a no-op write.
      const resetRows = await trx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility: 'private' })
        .where(and(eq(agentShares.agentId, agentId), ne(agentShares.visibility, 'private')))
        .returning({ agentId: agentShares.agentId });
      didResetShare = resetRows.length > 0;

      // Bumped in the SAME transaction as the reset above (still holding the
      // `agents.id FOR UPDATE` lock taken at the top of this function) — see
      // `bumpAgentShareGeneration`'s JSDoc for why every writer/reader of
      // this counter must share that lock.
      if (didResetShare) revocationGeneration = await bumpAgentShareGeneration(trx, agentId);
    }

    return { didResetShare, revocationGeneration, updated: updated ?? null };
  });

  // Fired only after the transaction above has committed — `onShareReset`
  // callers schedule runtime side effects (device gateway calls, operation
  // interrupts) that must never fire on a rollback. See this param's JSDoc.
  if (didResetShare) onShareReset?.(agentId, revocationGeneration!);

  return updated;
}
