import { and, asc, eq, getTableColumns, isNull } from 'drizzle-orm';

import {
  type AgentInterventionItem,
  agentInterventionResolutions,
  agentInterventions,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * The scope every `AgentInterventionModel` helper runs in, passed as the first
 * argument instead of `this` so the helper modules never import the class.
 */
export interface AgentInterventionContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

const {
  customExecutionAttempt: _customExecutionAttempt,
  customExecutionInputHash: _customExecutionInputHash,
  customExecutionLeaseExpiresAt: _customExecutionLeaseExpiresAt,
  customExecutionLeaseToken: _customExecutionLeaseToken,
  customExecutionResult: _customExecutionResult,
  customExecutionState: _customExecutionState,
  ...publicResolutionColumns
} = getTableColumns(agentInterventionResolutions);

export { publicResolutionColumns };

export const ownership = (ctx: AgentInterventionContext) =>
  and(
    eq(agentInterventions.userId, ctx.userId),
    ctx.workspaceId
      ? eq(agentInterventions.workspaceId, ctx.workspaceId)
      : isNull(agentInterventions.workspaceId),
  );

export const resolutionOwnership = (ctx: AgentInterventionContext) =>
  and(
    eq(agentInterventionResolutions.userId, ctx.userId),
    ctx.workspaceId
      ? eq(agentInterventionResolutions.workspaceId, ctx.workspaceId)
      : isNull(agentInterventionResolutions.workspaceId),
  );

export const ownerOnly = (ctx: AgentInterventionContext) =>
  eq(agentInterventions.userId, ctx.userId);

export const reload = async (
  ctx: AgentInterventionContext,
  id: string,
): Promise<AgentInterventionItem | undefined> => {
  const [row] = await ctx.db
    .select()
    .from(agentInterventions)
    .where(and(eq(agentInterventions.id, id), ownership(ctx)))
    .limit(1);
  return row;
};

export const reloadBatch = (
  ctx: AgentInterventionContext,
  operationId: string,
  batchId: string,
): Promise<AgentInterventionItem[]> =>
  ctx.db
    .select()
    .from(agentInterventions)
    .where(
      and(
        eq(agentInterventions.operationId, operationId),
        eq(agentInterventions.batchId, batchId),
        ownership(ctx),
      ),
    )
    .orderBy(asc(agentInterventions.itemIndex));
