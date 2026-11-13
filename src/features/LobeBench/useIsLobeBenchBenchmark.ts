import { useEvalStore } from '@/store/eval';
import { isLobeBenchKind } from '@/store/eval/kinds';

/** Whether this benchmark belongs to Lobe Bench (the Lab's pages also show Lobe Bench runs). */
export const useIsLobeBenchBenchmark = (benchmarkId?: string) =>
  useEvalStore((s) =>
    benchmarkId
      ? isLobeBenchKind(
          s.benchmarkDetailMap[benchmarkId] ?? s.benchmarkList.find((b) => b.id === benchmarkId),
        )
      : false,
  );
