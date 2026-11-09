import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  userConnectors,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';

/**
 * Deletes a user-owned Dataset together with the private evaluation
 * connections it marked. Connections are their own aggregate, so the unit of
 * work lives here rather than in `AgentEvalDatasetModel`.
 */
export class AgentEvalDatasetDeletionRepo {
  private readonly scope: { userId: string; workspaceId?: string };

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
  ) {
    this.scope = { userId, workspaceId: normalizeWorkspaceId(workspaceId) ?? undefined };
  }

  /** Mutate-only predicate excluding system rows. */
  private mutableOwnership = () =>
    and(buildWorkspaceWhere(this.scope, agentEvalDatasets), isNotNull(agentEvalDatasets.userId));

  deleteDataset = async (id: string) =>
    this.db.transaction(async (tx) => {
      const [dataset] = await tx
        .select({ id: agentEvalDatasets.id })
        .from(agentEvalDatasets)
        .where(and(eq(agentEvalDatasets.id, id), this.mutableOwnership()))
        .for('update');
      if (dataset) {
        // The Dataset marker has no FK. Remove its private credentials in the
        // same transaction; connection tools cascade through their existing FK.
        await tx
          .delete(userConnectors)
          .where(
            and(
              buildWorkspaceWhere(this.scope, userConnectors),
              sql`${userConnectors.metadata} -> 'agentEval' ->> 'datasetId' = ${dataset.id}`,
            ),
          );
      }
      const usedEnvironments = dataset
        ? await tx
            .selectDistinct({ id: agentEvalTestCases.environmentId })
            .from(agentEvalTestCases)
            .where(eq(agentEvalTestCases.datasetId, dataset.id))
        : [];
      const result = await tx
        .delete(agentEvalDatasets)
        .where(and(eq(agentEvalDatasets.id, id), this.mutableOwnership()));
      // Environments holding stored connections (and their encrypted credentials)
      // go with the last Dataset using them, like the Dataset's connector rows.
      const environmentIds = usedEnvironments.flatMap(({ id }) => (id ? [id] : []));
      if (environmentIds.length)
        await tx
          .delete(agentEvalEnvironments)
          .where(
            and(
              inArray(agentEvalEnvironments.id, environmentIds),
              buildWorkspaceWhere(this.scope, agentEvalEnvironments),
              isNotNull(agentEvalEnvironments.userId),
              sql`${agentEvalEnvironments.config} ? 'connections'`,
              sql`NOT EXISTS (SELECT 1 FROM ${agentEvalTestCases} WHERE ${agentEvalTestCases.environmentId} = ${agentEvalEnvironments.id})`,
            ),
          );
      return result;
    });
}
