import { TRPCError } from '@trpc/server';

/** `metadata.kind` of Lobe Bench rows (the Evaluation Lab's have none). */
const LOBE_BENCH_KIND = 'lobe-bench';

type Metadata = Record<string, unknown> | null | undefined;

const isLobeBench = (metadata: Metadata) => metadata?.kind === LOBE_BENCH_KIND;

interface MembershipContext {
  benchmarkModel: {
    findById: (id: string) => Promise<{ metadata?: Metadata } | undefined | null>;
    releaseDatasets: (id: string) => Promise<number>;
  };
  datasetModel: {
    findById: (
      id: string,
    ) => Promise<{ benchmarkId?: string | null; metadata?: Metadata } | undefined | null>;
  };
  experimentModel: {
    delete: (id: string) => Promise<unknown>;
    findByBenchmarkIds: (benchmarkIds: string[]) => Promise<Array<{ experimentId: string }>>;
    findById: (
      id: string,
    ) => Promise<{ benchmarks: Array<{ id: string }>; runs: unknown[] } | undefined>;
  };
  runModel: {
    query: (filter: {
      benchmarkId: string;
      limit?: number;
    }) => Promise<Array<{ id: string; status?: string | null }>>;
  };
  runService: { deleteRun: (id: string) => Promise<unknown> };
}

const refuse = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

/**
 * A Lobe Bench benchmark is made of its datasets once: a dataset in one stays
 * in it until the benchmark is deleted, and a benchmark that has run takes no
 * more. (Making one adds its datasets right after creating it, before any run.)
 */
export const assertDatasetMove = async (
  ctx: MembershipContext,
  datasetId: string,
  benchmarkId: string | undefined,
) => {
  if (benchmarkId === undefined) return;
  const dataset = await ctx.datasetModel.findById(datasetId);
  if (!dataset || !isLobeBench(dataset.metadata)) return;
  if ((dataset.benchmarkId ?? null) === benchmarkId) return;
  if (dataset.benchmarkId)
    throw refuse(
      'A dataset stays in the benchmark it is part of. Delete the benchmark to use its datasets elsewhere.',
    );
  const target = await ctx.benchmarkModel.findById(benchmarkId);
  if (!isLobeBench(target?.metadata)) return;
  if ((await ctx.runModel.query({ benchmarkId, limit: 1 })).length > 0)
    throw refuse('A benchmark that has runs keeps the datasets it was made of.');
};

/** A dataset in a Lobe Bench benchmark is deleted only by deleting the benchmark. */
export const assertDatasetDeletable = async (ctx: MembershipContext, datasetId: string) => {
  const dataset = await ctx.datasetModel.findById(datasetId);
  if (dataset && isLobeBench(dataset.metadata) && dataset.benchmarkId)
    throw refuse(
      'This dataset is part of a benchmark. Delete the benchmark first; its datasets are kept.',
    );
};

/**
 * Before a Lobe Bench benchmark is deleted: its runs go with it (with their
 * conversations and case Agents), and its datasets are freed rather than
 * deleted. An experiment made on this benchmark alone is left with nothing
 * once its runs go, so it goes too; one that spans other benchmarks or still
 * has runs stays. Refused while one of its runs is still going.
 */
export const prepareBenchmarkDeletion = async (ctx: MembershipContext, benchmarkId: string) => {
  const benchmark = await ctx.benchmarkModel.findById(benchmarkId);
  if (!isLobeBench(benchmark?.metadata)) return;
  const runs = await ctx.runModel.query({ benchmarkId });
  if (runs.some((run) => run.status === 'pending' || run.status === 'running'))
    throw refuse('Stop the experiments still running on this benchmark before deleting it.');
  const experiments = await ctx.experimentModel.findByBenchmarkIds([benchmarkId]);
  for (const run of runs) await ctx.runService.deleteRun(run.id);
  await ctx.benchmarkModel.releaseDatasets(benchmarkId);
  for (const { experimentId } of experiments) {
    const experiment = await ctx.experimentModel.findById(experimentId);
    if (!experiment) continue;
    const onlyThisBenchmark = experiment.benchmarks.every(({ id }) => id === benchmarkId);
    if (onlyThisBenchmark && experiment.runs.length === 0)
      await ctx.experimentModel.delete(experimentId);
  }
};
