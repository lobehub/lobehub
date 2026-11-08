/** Accept generated and caller-supplied opaque ids without path/query syntax. */
export const parseExperimentId = (value: string | null): string | undefined =>
  value && /^[\w-]+$/.test(value) ? value : undefined;

export const experimentContextSuffix = (experimentId: string | undefined): string =>
  experimentId ? `?${new URLSearchParams({ experiment: experimentId })}` : '';

const LOBE_BENCH_ROOT = '/eval/lobe-bench';

/**
 * Where the Evaluation Lab's run page leads back to. Lobe Bench opens its runs
 * on that page too, so a Lobe Bench run returns to Lobe Bench: the experiment
 * it was started from, else its benchmark.
 */
export const runBackPath = ({
  benchmarkId,
  experimentId,
  lobeBench,
}: {
  benchmarkId: string;
  experimentId?: string | null;
  lobeBench: boolean;
}): string => {
  if (!lobeBench) return `/eval/bench/${benchmarkId}`;
  const experiment = parseExperimentId(experimentId ?? null);
  return experiment
    ? `${LOBE_BENCH_ROOT}/experiments/${experiment}`
    : `${LOBE_BENCH_ROOT}/benchmarks/${benchmarkId}`;
};

/** The benchmark page on its own side: Lobe Bench's, or the Evaluation Lab's. */
export const benchmarkHomePath = (benchmarkId: string, lobeBench: boolean): string =>
  lobeBench ? `${LOBE_BENCH_ROOT}/benchmarks/${benchmarkId}` : `/eval/bench/${benchmarkId}`;

/** Where the benchmark sidebar's back arrow leads: Lobe Bench's benchmark page, or the Lab's home. */
export const benchmarkSidebarBackPath = (benchmarkId: string, lobeBench: boolean): string =>
  lobeBench ? benchmarkHomePath(benchmarkId, true) : '/eval';

/**
 * Where a benchmark sidebar's dataset opens: a Lobe Bench dataset in Lobe Bench,
 * any other at its benchmark-free Lab address (not the legacy one that redirects there).
 */
export const benchmarkDatasetPath = (datasetId: string, lobeBench: boolean): string =>
  lobeBench ? `${LOBE_BENCH_ROOT}/datasets/${datasetId}` : `/eval/datasets/${datasetId}`;

/**
 * Lobe Bench's one place to start an experiment, opened on a dataset's
 * benchmark when one is named. Every "new run / new experiment" button for a
 * Lobe Bench benchmark leads here, including those on the Evaluation Lab pages
 * its runs open in, so an experiment always starts the same way.
 */
export const newExperimentPath = (datasetId?: string | null): string =>
  `${LOBE_BENCH_ROOT}/experiments/new${datasetId ? `?${new URLSearchParams({ dataset: datasetId })}` : ''}`;
