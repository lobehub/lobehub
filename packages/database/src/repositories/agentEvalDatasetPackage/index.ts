import type { AgentEvalDatasetPackage, AgentEvalDatasetPackageBindings } from '@lobechat/types';
import { and, eq, isNotNull } from 'drizzle-orm';

import {
  AgentEvalDatasetWriteError,
  assertWritableEvalDatasets,
  isFixedLobeBenchDataset,
} from '../../models/agentEval/datasetAccess';
import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalRuns,
  agentEvalTestCases,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere, normalizeWorkspaceId } from '../../utils/workspace';
import { bindDatasetPackage } from './bindings';
import { type EvalPackageCredentialEncryptor, preparePackageConnections } from './connections';
import { AgentEvalDatasetPackageImportError } from './errors';

export { AgentEvalDatasetPackageImportError } from './errors';

/** Imports a complete package in one transaction, without mutating any existing cases or results. */
export class AgentEvalDatasetPackageRepo {
  private readonly workspaceId?: string;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string,
    private readonly credentialEncryptor?: EvalPackageCredentialEncryptor,
  ) {
    this.workspaceId = normalizeWorkspaceId(workspaceId) ?? undefined;
  }

  importPackage = async (params: {
    benchmarkId?: string;
    bindings?: AgentEvalDatasetPackageBindings;
    datasetId?: string;
    name?: string;
    package: AgentEvalDatasetPackage;
    sha256: string;
  }) => {
    const connections = await preparePackageConnections(
      params.package,
      params.bindings,
      this.credentialEncryptor,
    );
    // Environment ids are fixed up front: a connection stored in an Environment
    // is bound by an id that names that Environment.
    const assignedEnvironmentIds = new Map(
      params.package.environments.map((environment) => [environment.key, crypto.randomUUID()]),
    );
    const pack = bindDatasetPackage(params.package, params.bindings, {
      connections,
      environmentIds: assignedEnvironmentIds,
    });
    return this.db.transaction(async (tx) => {
      const scope = { userId: this.userId, workspaceId: this.workspaceId };
      const ownership = { userId: this.userId, workspaceId: this.workspaceId ?? null };
      let benchmarkId: string | null = null;
      let datasetId: string;
      const source = {
        format: pack.format,
        sha256: params.sha256,
        version: pack.version,
      };
      const metadata = {
        ...pack.dataset.metadata,
        importedPackage: source,
        release: pack.dataset.metadata?.release ?? `sha256:${params.sha256}`,
      };

      if (params.datasetId) {
        const [dataset] = await assertWritableEvalDatasets(tx, scope, [params.datasetId]);
        const [existingCase] = await tx
          .select({ id: agentEvalTestCases.id })
          .from(agentEvalTestCases)
          .where(eq(agentEvalTestCases.datasetId, dataset.id))
          .limit(1);
        const [existingRun] = await tx
          .select({ id: agentEvalRuns.id })
          .from(agentEvalRuns)
          .where(eq(agentEvalRuns.datasetId, dataset.id))
          .limit(1);
        if (existingCase || existingRun) {
          throw new AgentEvalDatasetPackageImportError(
            'Import a ZIP package into a new or empty dataset without runs. Existing cases and results are preserved.',
          );
        }
        const fixed = await isFixedLobeBenchDataset(tx, dataset);
        await tx
          .update(agentEvalDatasets)
          .set({
            description: pack.dataset.description ?? dataset.description,
            evalConfig: pack.dataset.evalConfig ?? dataset.evalConfig,
            evalMode: pack.dataset.evalMode ?? dataset.evalMode,
            metadata: {
              ...dataset.metadata,
              ...metadata,
              ...(fixed && { custom: true, kind: 'lobe-bench' }),
            },
            name: params.name ?? dataset.name,
            updatedAt: new Date(),
          })
          .where(eq(agentEvalDatasets.id, dataset.id));
        datasetId = dataset.id;
        benchmarkId = dataset.benchmarkId;
      } else {
        if (params.benchmarkId) {
          const [benchmark] = await tx
            .select()
            .from(agentEvalBenchmarks)
            .where(
              and(
                eq(agentEvalBenchmarks.id, params.benchmarkId),
                buildWorkspaceWhere(scope, agentEvalBenchmarks),
                isNotNull(agentEvalBenchmarks.userId),
                eq(agentEvalBenchmarks.isSystem, false),
              ),
            )
            .for('update');
          if (!benchmark || benchmark.metadata?.kind !== 'lobe-bench') {
            throw new AgentEvalDatasetWriteError(
              'Choose a LobeBench benchmark owned by your account or workspace',
            );
          }
          benchmarkId = benchmark.id;
        }
        // Without a target an import only imports: a dataset in no benchmark. A
        // benchmark is made separately, of datasets, with its judge and run rules.
        const [dataset] = await tx
          .insert(agentEvalDatasets)
          .values({
            ...ownership,
            benchmarkId,
            description: pack.dataset.description,
            evalConfig: pack.dataset.evalConfig,
            evalMode: pack.dataset.evalMode,
            identifier: `import-${crypto.randomUUID()}`,
            metadata: { ...metadata, custom: true, kind: 'lobe-bench' },
            name: params.name ?? pack.dataset.name,
          })
          .returning({ id: agentEvalDatasets.id });
        datasetId = dataset.id;
      }

      // Package keys are local references, never existing database IDs or unique identifiers.
      const environments = pack.environments.length
        ? await tx
            .insert(agentEvalEnvironments)
            .values(
              pack.environments.map((environment) => ({
                ...ownership,
                config: environment.config,
                id: assignedEnvironmentIds.get(environment.key)!,
                description: environment.description,
                metadata: { importedPackage: source, packageKey: environment.key },
                name: environment.name,
              })),
            )
            .returning({ id: agentEvalEnvironments.id, metadata: agentEvalEnvironments.metadata })
        : [];
      const environmentIds = new Map(
        environments.map((environment) => [environment.metadata?.packageKey, environment.id]),
      );
      const cases = pack.cases.map((testCase, index) => {
        const environmentId = testCase.environmentKey
          ? environmentIds.get(testCase.environmentKey)
          : undefined;
        if (testCase.environmentKey && !environmentId) {
          throw new AgentEvalDatasetPackageImportError(
            'The package references an unknown environment',
          );
        }
        return {
          ...ownership,
          content: testCase.content,
          datasetId,
          environmentId,
          evalConfig: testCase.evalConfig,
          evalMode: testCase.evalMode,
          metadata: {
            ...testCase.metadata,
            caseId: testCase.key,
            importedPackage: source,
            source: 'zip',
          },
          sortOrder: testCase.sortOrder ?? index + 1,
        };
      });
      await tx.insert(agentEvalTestCases).values(cases);
      return { benchmarkId, count: cases.length, datasetId, environmentCount: environments.length };
    });
  };
}
