'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, confirmModal, toast } from '@lobehub/ui/base-ui';
import { Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { createDatasetCreateModal } from '@/features/Eval/DatasetCreateModal';
import { createDatasetEditModal } from '@/features/Eval/DatasetEditModal';
import { createDatasetImportModal } from '@/features/Eval/DatasetImportModal';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { createRunCreateModal } from '../RunCreateModal';
import DatasetRow, { datasetRowStyles } from './DatasetRow';
import DatasetsSkeleton from './DatasetsSkeleton';
import EmptyState from './EmptyState';

interface DatasetsTabProps {
  benchmarkId: string;
}

/** Create a dataset, then offer to import its cases right away. */
export const useCreateDataset = (benchmarkId: string) => {
  const { t } = useTranslation('eval');
  const refreshDatasets = useEvalStore((s) => s.refreshDatasets);

  return useCallback(() => {
    const refresh = () => refreshDatasets(benchmarkId);
    createDatasetCreateModal({
      benchmarkId,
      onSuccess: (dataset) => {
        void refresh();
        confirmModal({
          cancelText: t('common.later'),
          content: t('dataset.create.importNow'),
          okText: t('dataset.actions.import'),
          onOk: () => {
            createDatasetImportModal({
              datasetId: dataset.id,
              onSuccess: () => void refresh(),
              presetId: dataset.preset,
            });
          },
          title: t('dataset.create.successTitle'),
        });
      },
    });
  }, [benchmarkId, refreshDatasets, t]);
};

const DatasetsTab = ({ benchmarkId }: DatasetsTabProps) => {
  const { t } = useTranslation('eval');
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const datasets = useEvalStore((s) => s.datasetList);
  const refreshDatasets = useEvalStore((s) => s.refreshDatasets);
  const { data, error, isLoading, mutate } = useFetchDatasets(benchmarkId);
  const handleCreate = useCreateDataset(benchmarkId);

  const refresh = () => void refreshDatasets(benchmarkId);

  const handleDelete = (dataset: any) =>
    confirmModal({
      content: t('dataset.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteDataset(dataset.id);
          toast.success(t('dataset.delete.success'));
          refresh();
        } catch {
          toast.error(t('dataset.delete.error'));
        }
      },
      title: t('common.delete'),
    });

  return (
    <AsyncBoundary
      data={data}
      empty={<EmptyState onAddDataset={handleCreate} />}
      error={error}
      isEmpty={!error && datasets.length === 0}
      isLoading={isLoading && datasets.length === 0}
      loading={<DatasetsSkeleton />}
      onRetry={() => void mutate()}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal justify="flex-end">
          <Button icon={Plus} size="small" onClick={handleCreate}>
            {t('dataset.actions.addDataset')}
          </Button>
        </Flexbox>
        <div className={datasetRowStyles.list}>
          {datasets.map((ds: any) => (
            <DatasetRow
              dataset={ds}
              key={ds.id}
              onDelete={() => handleDelete(ds)}
              onEdit={() => createDatasetEditModal({ dataset: ds, onSuccess: refresh })}
              onImport={() =>
                createDatasetImportModal({
                  datasetId: ds.id,
                  onSuccess: refresh,
                  presetId: ds.metadata?.preset,
                })
              }
              onRun={() =>
                createRunCreateModal({ benchmarkId, datasetId: ds.id, datasetName: ds.name })
              }
            />
          ))}
        </div>
      </Flexbox>
    </AsyncBoundary>
  );
};

export default DatasetsTab;
