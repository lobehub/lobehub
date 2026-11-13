import type {
  AgentEvalDatasetConnectorRequirement,
  AgentEvalDatasetPackageBindings,
} from '@lobechat/types';
import { parseEnvironmentConnectionId } from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

import {
  AgentEvalDatasetWriteError,
  assertWritableEvalDatasets,
} from '../../models/agentEval/datasetAccess';
import { activeEvalTestCases } from '../../models/agentEval/testCase';
import {
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  userConnectors,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';
import { AgentEvalEnvironmentConnectionRepo } from '../agentEvalEnvironmentConnection';
import { assertCompleteConnectorBindings, environmentMockServices } from './bindings';
import { AgentEvalDatasetPackageImportError } from './errors';

/** Connection repair changes local bindings only, preserving dataset content and release identity. */
export class AgentEvalDatasetConnectorRepo {
  private readonly scope: { userId: string; workspaceId?: string };

  constructor(
    private readonly db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
  ) {
    this.scope = { userId, workspaceId: normalizeWorkspaceId(workspaceId) ?? undefined };
  }

  private read = async (
    db: LobeChatDatabase | Transaction,
    datasetId: string,
    includeSystem = false,
    lockEnvironments = false,
  ) => {
    const [dataset] = await db
      .select({ id: agentEvalDatasets.id })
      .from(agentEvalDatasets)
      .where(
        and(
          eq(agentEvalDatasets.id, datasetId),
          includeSystem
            ? or(
                buildWorkspaceWhere(this.scope, agentEvalDatasets),
                isNull(agentEvalDatasets.userId),
              )
            : and(
                buildWorkspaceWhere(this.scope, agentEvalDatasets),
                isNotNull(agentEvalDatasets.userId),
              ),
        ),
      )
      .limit(1);
    if (!dataset) throw new AgentEvalDatasetWriteError();
    const cases = await db
      .select()
      .from(agentEvalTestCases)
      .where(
        and(
          eq(agentEvalTestCases.datasetId, datasetId),
          includeSystem
            ? or(
                buildWorkspaceWhere(this.scope, agentEvalTestCases),
                isNull(agentEvalTestCases.userId),
              )
            : and(
                buildWorkspaceWhere(this.scope, agentEvalTestCases),
                isNotNull(agentEvalTestCases.userId),
              ),
          activeEvalTestCases(),
        ),
      );
    const ids = [
      ...new Set(
        cases.flatMap((testCase) => (testCase.environmentId ? [testCase.environmentId] : [])),
      ),
    ];
    const environmentQuery = db
      .select()
      .from(agentEvalEnvironments)
      .where(
        and(
          inArray(agentEvalEnvironments.id, ids),
          includeSystem
            ? or(
                buildWorkspaceWhere(this.scope, agentEvalEnvironments),
                isNull(agentEvalEnvironments.userId),
              )
            : and(
                buildWorkspaceWhere(this.scope, agentEvalEnvironments),
                isNotNull(agentEvalEnvironments.userId),
              ),
        ),
      )
      .orderBy(agentEvalEnvironments.id);
    const environments = ids.length
      ? await (lockEnvironments ? environmentQuery.for('update') : environmentQuery)
      : [];
    return { cases, environments };
  };

  /** Connections are chosen per Environment; a case only picks which of its services it uses. */
  private requirements = (
    rows: Awaited<ReturnType<AgentEvalDatasetConnectorRepo['read']>>,
  ): AgentEvalDatasetConnectorRequirement[] =>
    rows.environments
      .map((environment) => ({
        bindings: environment.config.connectorBindings ?? {},
        key: environment.id,
        name: environment.name,
        scope: 'environment' as const,
        services: environmentMockServices(environment.config),
      }))
      .filter((requirement) => requirement.services.length > 0);

  getBindings = async (datasetId: string) => ({
    requirements: this.requirements(await this.read(this.db, datasetId, true)),
  });

  updateBindings = async (datasetId: string, selections: AgentEvalDatasetPackageBindings) =>
    this.db.transaction(async (tx) => {
      await assertWritableEvalDatasets(tx, this.scope, [datasetId]);
      // Serialize binding with case assignment before checking cross-Dataset references.
      const rows = await this.read(tx, datasetId, false, true);
      const requirements = this.requirements(rows);
      if (Object.keys(selections.caseBindings ?? {}).length > 0)
        throw new AgentEvalDatasetPackageImportError(
          'Mock connections belong to an Environment. Choose them for the Environment, not for a case.',
        );
      for (const [scope, selected] of [['environment', selections.environmentBindings]] as const)
        for (const [id, bindings] of Object.entries(selected ?? {})) {
          const requirement = requirements.find((item) => item.scope === scope && item.key === id);
          if (!requirement)
            throw new AgentEvalDatasetPackageImportError(
              'The selected dataset environment or case is unavailable',
            );
          assertCompleteConnectorBindings(requirement.services, bindings);
          if (scope === 'environment') {
            const [otherReference] = await tx
              .select({ id: agentEvalTestCases.id })
              .from(agentEvalTestCases)
              .where(
                and(
                  eq(agentEvalTestCases.environmentId, id),
                  ne(agentEvalTestCases.datasetId, datasetId),
                  activeEvalTestCases(),
                ),
              )
              .limit(1);
            if (otherReference)
              throw new AgentEvalDatasetPackageImportError(
                'This environment is shared with another dataset. Copy the environment before changing its connections.',
              );
          }
        }
      const connectionIds = [
        ...new Set(
          Object.values(selections.environmentBindings ?? {}).flatMap((bindings) =>
            Object.values(bindings).map((binding) => binding.connectorId),
          ),
        ),
      ];
      // Connections stored in this Dataset's Environments are named by `env:` ids.
      const storedIds = connectionIds.filter((id) => parseEnvironmentConnectionId(id));
      const rowIds = connectionIds.filter((id) => !parseEnvironmentConnectionId(id));
      const stored = new AgentEvalEnvironmentConnectionRepo(
        this.db,
        this.scope.userId,
        this.scope.workspaceId,
      );
      for (const id of storedIds)
        if (!(await stored.find(datasetId, id, tx as unknown as LobeChatDatabase)))
          throw new AgentEvalDatasetPackageImportError(
            'A connection is unavailable or belongs to another Dataset',
          );
      if (rowIds.length) {
        const connections = await tx
          .select({ id: userConnectors.id })
          .from(userConnectors)
          .where(
            and(
              inArray(userConnectors.id, rowIds),
              buildWorkspaceWhere(this.scope, userConnectors),
              sql`${userConnectors.metadata} -> 'agentEval' ->> 'datasetId' = ${datasetId}`,
            ),
          );
        if (connections.length !== rowIds.length)
          throw new AgentEvalDatasetPackageImportError(
            'A connection is unavailable or belongs to another Dataset',
          );
      }
      for (const environment of rows.environments) {
        const bindings = selections.environmentBindings?.[environment.id];
        if (!bindings) continue;
        await tx
          .update(agentEvalEnvironments)
          .set({
            config: { ...environment.config, connectorBindings: bindings },
            updatedAt: new Date(),
          })
          .where(eq(agentEvalEnvironments.id, environment.id));
      }
      return { success: true as const };
    });
}
