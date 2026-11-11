import type { EvalCaseEnvironment } from '@lobechat/types';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
  userConnectors,
} from '../../schemas';
import type { Transaction } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

export class AgentEvalDatasetWriteError extends Error {
  constructor(message = 'Dataset not found or not writable') {
    super(message);
    this.name = 'AgentEvalDatasetWriteError';
  }
}

/** Classify by domain, independently of the dataset's write authorization. */
export const isFixedLobeBenchDataset = async (
  tx: Transaction,
  dataset: { benchmarkId?: string | null; metadata?: Record<string, unknown> | null },
) => {
  if (dataset.metadata?.kind === 'lobe-bench') return true;
  if (!dataset.benchmarkId) return false;
  const [benchmark] = await tx
    .select({ metadata: agentEvalBenchmarks.metadata })
    .from(agentEvalBenchmarks)
    .where(eq(agentEvalBenchmarks.id, dataset.benchmarkId))
    .limit(1);
  return benchmark?.metadata?.kind === 'lobe-bench';
};

export const assertReadableEvalEnvironments = async (
  tx: Transaction,
  scope: { userId: string; workspaceId?: string },
  cases: Array<{
    content: { environment?: EvalCaseEnvironment };
    datasetId: string;
    environmentId?: string | null;
  }>,
) => {
  const ids = [
    ...new Set(cases.map(({ environmentId }) => environmentId).filter((id): id is string => !!id)),
  ];
  const environments = ids.length
    ? await tx
        .select({ config: agentEvalEnvironments.config, id: agentEvalEnvironments.id })
        .from(agentEvalEnvironments)
        .where(
          and(
            inArray(agentEvalEnvironments.id, ids),
            or(
              buildWorkspaceWhere(scope, agentEvalEnvironments),
              isNull(agentEvalEnvironments.userId),
            ),
          ),
        )
        .orderBy(agentEvalEnvironments.id)
        .for('share')
    : [];
  if (environments.length !== ids.length) {
    throw new AgentEvalDatasetWriteError('Environment not found or not readable');
  }
  const shared = new Map(environments.map(({ config, id }) => [id, config]));
  const connections = new Map<string, Set<string>>();
  for (const testCase of cases) {
    const configs = [
      testCase.environmentId ? shared.get(testCase.environmentId) : undefined,
      testCase.content.environment,
    ];
    for (const config of configs) {
      const bindings = Object.values(config?.connectorBindings ?? {});
      if (!bindings.length) continue;
      const ids = connections.get(testCase.datasetId) ?? new Set<string>();
      for (const { connectorId } of bindings) ids.add(connectorId);
      connections.set(testCase.datasetId, ids);
    }
  }
  // Validate every reference, including a shared binding shadowed by a case override.
  // Unbound environments remain reusable; connection identity belongs to one Dataset.
  for (const [datasetId, ids] of connections) {
    const rows = await tx
      .select({ id: userConnectors.id })
      .from(userConnectors)
      .where(
        and(
          inArray(userConnectors.id, [...ids]),
          buildWorkspaceWhere(scope, userConnectors),
          sql`${userConnectors.metadata} -> 'agentEval' ->> 'datasetId' = ${datasetId}`,
        ),
      );
    if (rows.length !== ids.size) {
      throw new AgentEvalDatasetWriteError(
        'Environment connection is unavailable or belongs to another Dataset',
      );
    }
  }
};

/** Lock parents before checking them, so concurrent initial imports cannot both succeed. */
export const assertWritableEvalDatasets = async (
  tx: Transaction,
  scope: { userId: string; workspaceId?: string },
  datasetIds: string[],
) => {
  const ids = [...new Set(datasetIds)].sort();
  const datasets = await tx
    .select()
    .from(agentEvalDatasets)
    .where(
      and(
        inArray(agentEvalDatasets.id, ids),
        buildWorkspaceWhere(scope, agentEvalDatasets),
        isNotNull(agentEvalDatasets.userId),
      ),
    )
    .orderBy(agentEvalDatasets.id)
    .for('update');

  if (datasets.length !== ids.length) throw new AgentEvalDatasetWriteError();
  return datasets;
};

export const assertEvalDatasetCasesMutable = async (
  tx: Transaction,
  datasets: Array<{
    benchmarkId?: string | null;
    id: string;
    metadata: Record<string, unknown> | null;
  }>,
) => {
  for (const dataset of datasets) {
    if (!(await isFixedLobeBenchDataset(tx, dataset))) continue;
    const [existing] = await tx
      .select({ id: agentEvalTestCases.id })
      .from(agentEvalTestCases)
      .where(eq(agentEvalTestCases.datasetId, dataset.id))
      .limit(1);
    if (existing) {
      throw new AgentEvalDatasetWriteError(
        'Lobe Bench dataset cases are fixed after creation; create a new dataset instead',
      );
    }
  }
};
