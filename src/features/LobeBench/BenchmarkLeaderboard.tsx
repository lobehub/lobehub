'use client';

import { memo, useMemo } from 'react';

import ContenderRanking from '@/features/LobeBench/ContenderRanking';
import {
  benchmarkDatasetsOf,
  rankableSetsOf,
  sortBenchmarks,
} from '@/features/LobeBench/lobeBench';
import {
  useLobeBenchBenchmarks,
  useLobeBenchDatasets,
  useLobeBenchRuns,
} from '@/features/LobeBench/useLobeBench';

/**
 * A Lobe Bench benchmark's leaderboard, read on its own: for pages that show
 * the benchmark without the Lobe Bench workspace around it (the Evaluation
 * Lab's benchmark page). Renders nothing until the benchmark has a dataset.
 */
const BenchmarkLeaderboard = memo<{ benchmarkId: string }>(({ benchmarkId }) => {
  const { benchmarks: benchmarkList } = useLobeBenchBenchmarks();
  const benchmarks = useMemo(() => sortBenchmarks(benchmarkList), [benchmarkList]);
  const benchmarkIds = useMemo(() => benchmarks.map((b) => b.id), [benchmarks]);
  const { data: datasets } = useLobeBenchDatasets(benchmarkIds);
  const { data: allRuns } = useLobeBenchRuns(benchmarkIds);

  const listed = benchmarks.find((b) => b.id === benchmarkId);
  const madeOf = useMemo(
    () => (listed ? benchmarkDatasetsOf(datasets, listed) : []),
    [datasets, listed],
  );
  const sets = useMemo(
    () => rankableSetsOf(benchmarks, datasets).filter((set) => set.benchmarkId === benchmarkId),
    [benchmarkId, benchmarks, datasets],
  );
  const runs = useMemo(
    () => (allRuns ?? []).filter((run) => madeOf.some((dataset) => dataset.id === run.datasetId)),
    [allRuns, madeOf],
  );

  if (sets.length === 0) return null;
  return <ContenderRanking benchmarkId={benchmarkId} runs={runs} sets={sets} />;
});

BenchmarkLeaderboard.displayName = 'BenchmarkLeaderboard';

export default BenchmarkLeaderboard;
