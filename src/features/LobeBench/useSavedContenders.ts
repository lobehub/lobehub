import { useCallback, useMemo } from 'react';

import {
  getBenchmarkMeta,
  isBuiltInBenchmark,
  isLobeBenchMeta,
  type LobeBenchContender,
  pickPrimaryBenchmark,
  upsertContenders,
} from '@/features/LobeBench/lobeBench';
import { useLobeBenchBenchmarks, useLobeBenchExperiments } from '@/features/LobeBench/useLobeBench';
import { useEvalStore } from '@/store/eval';

/**
 * The account's contenders: the ones saved in the primary benchmark's
 * metadata plus every contender a past experiment ran, so nothing that ran
 * before has to be set up twice. `save` replaces the saved list and refreshes
 * every reader.
 */
export const useSavedContenders = () => {
  const { benchmarks } = useLobeBenchBenchmarks();
  const { experiments } = useLobeBenchExperiments();
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);
  const benchmark = pickPrimaryBenchmark(benchmarks);
  const saved = getBenchmarkMeta(benchmark).contenders;

  const contenders = useMemo(() => {
    // Oldest experiment first, so the saved order (and names) win over reruns.
    const ran = [...experiments]
      .reverse()
      .flatMap((experiment) =>
        isLobeBenchMeta(experiment.metadata) ? experiment.metadata.contenders : [],
      );
    return upsertContenders(saved, ran);
  }, [experiments, saved]);

  const save = useCallback(
    async (list: LobeBenchContender[]) => {
      // A built-in benchmark cannot carry an account's list; its contenders
      // are the ones past experiments ran.
      if (!benchmark || isBuiltInBenchmark(benchmark)) return;
      await updateBenchmark({
        description: benchmark.description ?? undefined,
        id: benchmark.id,
        identifier: benchmark.identifier,
        metadata: { ...benchmark.metadata, contenders: list },
        name: benchmark.name,
      });
    },
    [benchmark, updateBenchmark],
  );

  return { benchmark, contenders, save };
};
