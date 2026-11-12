import { toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { refreshLobeBenchDatasets } from '@/features/LobeBench/datasetCases';
import { LOBE_BENCH_PATH } from '@/features/LobeBench/lobeBench';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { createDatasetImportModal } from '@/routes/(main)/eval/features/DatasetImportModal';
import { useEvalStore } from '@/store/eval';

/**
 * Imports a dataset ZIP as a dataset of its own, in no benchmark: a benchmark
 * is made separately, of datasets, with its judge and run rules.
 */
export const useImportLobeBenchDataset = () => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();

  return () =>
    createDatasetImportModal({
      archiveOnly: true,
      onSuccess: async (datasetId) => {
        try {
          await useEvalStore.getState().refreshBenchmarks();
          await Promise.all([
            refreshLobeBenchDatasets(),
            useEvalStore.getState().refreshDatasetCases(datasetId),
          ]);
        } catch {
          // Import has committed. A cache refresh failure must not suggest importing twice.
          toast.error(t('dataset.import.package.refreshError'));
        } finally {
          navigate(`${LOBE_BENCH_PATH}/datasets/${datasetId}`);
        }
      },
    });
};
