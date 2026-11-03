import type {
  AgentEvalDatasetConnectorRequirement,
  AgentEvalDatasetPackageBindings,
  EvalCaseEnvironment,
} from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';

import {
  AgentEvalDatasetWriteError,
  assertWritableEvalDatasets,
} from '../../models/agentEval/datasetAccess';
import { activeEvalTestCases } from '../../models/agentEval/testCase';
import { agentEvalDatasets, agentEvalEnvironments, agentEvalTestCases } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';
import {
  assertCompleteConnectorBindings,
  effectiveMockServices,
  environmentMockServices,
} from './bindings';
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
    const environments = ids.length
      ? await db
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
      : [];
    return { cases, environments };
  };

  private requirements = (
    rows: Awaited<ReturnType<AgentEvalDatasetConnectorRepo['read']>>,
  ): AgentEvalDatasetConnectorRequirement[] => {
    const shared = new Map(
      rows.environments.map((environment) => [environment.id, environment.config]),
    );
    return [
      ...rows.environments.map((environment) => ({
        bindings: environment.config.connectorBindings ?? {},
        key: environment.id,
        name: environment.name,
        scope: 'environment' as const,
        services: environmentMockServices(environment.config),
      })),
      ...rows.cases
        .filter((testCase) => environmentMockServices(testCase.content.environment).length > 0)
        .map((testCase) => {
          const parent = testCase.environmentId ? shared.get(testCase.environmentId) : undefined;
          const own = testCase.content.environment;
          const services = effectiveMockServices(parent, own);
          return {
            bindings: Object.fromEntries(
              Object.entries(own?.connectorBindings ?? parent?.connectorBindings ?? {}).filter(
                ([service]) => services.includes(service),
              ),
            ),
            key: testCase.id,
            name: String(testCase.metadata?.caseId ?? testCase.id),
            scope: 'case' as const,
            services,
          };
        }),
    ].filter((requirement) => requirement.services.length > 0);
  };

  getBindings = async (datasetId: string) => ({
    requirements: this.requirements(await this.read(this.db, datasetId, true)),
  });

  updateBindings = async (datasetId: string, selections: AgentEvalDatasetPackageBindings) =>
    this.db.transaction(async (tx) => {
      await assertWritableEvalDatasets(tx, this.scope, [datasetId]);
      const rows = await this.read(tx, datasetId);
      const requirements = this.requirements(rows);
      for (const [scope, selected] of [
        ['environment', selections.environmentBindings],
        ['case', selections.caseBindings],
      ] as const)
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
                ),
              )
              .limit(1);
            if (otherReference)
              throw new AgentEvalDatasetPackageImportError(
                'This environment is shared with another dataset. Copy the environment before changing its connections.',
              );
          }
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
      for (const testCase of rows.cases) {
        const bindings = selections.caseBindings?.[testCase.id];
        if (!bindings) continue;
        const environment: EvalCaseEnvironment = {
          ...testCase.content.environment,
          connectorBindings: bindings,
        };
        await tx
          .update(agentEvalTestCases)
          .set({
            content: { ...testCase.content, environment },
            updatedAt: new Date(),
          })
          .where(eq(agentEvalTestCases.id, testCase.id));
      }
      return { success: true as const };
    });
}
