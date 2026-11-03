import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { refreshLobeBenchDatasets } from '@/features/LobeBench/datasetCases';
import { isCustomBenchmark, LOBE_BENCH_PATH } from '@/features/LobeBench/lobeBench';
import { useLobeBenchBenchmarks } from '@/features/LobeBench/useLobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mutate } from '@/libs/swr';
import { createDatasetImportModal } from '@/routes/(main)/eval/features/DatasetImportModal';
import { useEvalStore } from '@/store/eval';

/** Import is available before any benchmark or dataset has been installed. */
export const useImportLobeBenchDataset = () => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const { benchmarks } = useLobeBenchBenchmarks();
  const ownBenchmarks = benchmarks.filter(isCustomBenchmark);

  return (options?: { benchmarkId?: string }) =>
    createDatasetImportModal({
      archiveOnly: true,
      benchmarkId: ownBenchmarks.some((benchmark) => benchmark.id === options?.benchmarkId)
        ? options?.benchmarkId
        : undefined,
      benchmarks: ownBenchmarks.map(({ id, name }) => ({ id, name })),
      onSuccess: async (datasetId) => {
        try {
          await useEvalStore.getState().refreshBenchmarks();
          await Promise.all([refreshLobeBenchDatasets(), mutate(['lobe-bench/cases', datasetId])]);
        } catch {
          // Import has committed. A cache refresh failure must not suggest importing twice.
          toast.error(t('dataset.import.package.refreshError'));
        } finally {
          navigate(`${LOBE_BENCH_PATH}/datasets/${datasetId}`);
        }
      },
    });
};
