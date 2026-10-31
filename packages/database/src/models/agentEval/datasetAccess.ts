import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import {
  agentEvalBenchmarks,
  agentEvalDatasets,
  agentEvalEnvironments,
  agentEvalTestCases,
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
  environmentIds: Array<string | null | undefined>,
) => {
  const ids = [...new Set(environmentIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const environments = await tx
    .select({ id: agentEvalEnvironments.id })
    .from(agentEvalEnvironments)
    .where(
      and(
        inArray(agentEvalEnvironments.id, ids),
        or(buildWorkspaceWhere(scope, agentEvalEnvironments), isNull(agentEvalEnvironments.userId)),
      ),
    );
  if (environments.length !== ids.length) {
    throw new AgentEvalDatasetWriteError('Environment not found or not readable');
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
