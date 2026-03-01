'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { App, Card, Skeleton } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Plus } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import DatasetCreateModal from '../../../../features/DatasetCreateModal';
import DatasetEditModal from '../../../../features/DatasetEditModal';
import DatasetImportModal from '../../../../features/DatasetImportModal';
import TestCaseCreateModal from '../../../../features/TestCaseCreateModal';
import RunCreateModal from '../RunCreateModal';
import DatasetCard from './DatasetCard';
import EmptyState from './EmptyState';

const loadingStyles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    .ant-card-body {
      padding: 0;
    }
  `,
  header: css`
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px;
  `,
  icon: css`
    flex-shrink: 0;

    width: 32px;
    height: 32px;
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface DatasetsTabProps {
  benchmarkId: string;
  datasets: any[];
  loading?: boolean;
  onImport: () => void;
  onRefresh: () => void;
}

const DatasetsTab = memo<DatasetsTabProps>(
  ({ benchmarkId, datasets, loading: datasetsLoading, onImport, onRefresh }) => {
    const { t } = useTranslation('eval');
    const { modal, message } = App.useApp();
    const [expandedDs, setExpandedDs] = useState<string | null>(null);
    const [pagination, setPagination] = useState({ current: 1, pageSize: 5 });
    const [search, setSearch] = useState('');
    const [diffFilter, setDiffFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');

    // Create, Edit, and Import modals
    const [createOpen, setCreateOpen] = useState(false);
    const [editDataset, setEditDataset] = useState<any | null>(null);
    const [importDatasetId, setImportDatasetId] = useState<string | null>(null);
    const [addCaseDatasetId, setAddCaseDatasetId] = useState<string | null>(null);
    const [runDatasetId, setRunDatasetId] = useState<string | null>(null);

    const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
    const refreshTestCases = useEvalStore((s) => s.refreshTestCases);

    // Fetch test cases for expanded dataset - use SWR return value directly
    const { data: testCaseData, isLoading: loading } = useFetchTestCases(
      expandedDs
        ? {
            datasetId: expandedDs,
            limit: pagination.pageSize,
            offset: (pagination.current - 1) * pagination.pageSize,
          }
        : { datasetId: '', limit: 0, offset: 0 },
    );

    const testCases = testCaseData?.data || [];
    const total = testCaseData?.total || 0;

    const handleRefreshTestCases = useCallback(
      async (datasetId: string) => {
        await refreshTestCases(datasetId);
        onRefresh();
      },
      [refreshTestCases, onRefresh],
    );

    const filteredCases = testCases.filter((c: any) => {
      if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
      if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    const handleExpand = useCallback((datasetId: string) => {
      setExpandedDs((prev) => (prev === datasetId ? null : datasetId));
      setPagination({ current: 1, pageSize: 5 });
      setSearch('');
      setDiffFilter('all');
    }, []);

    const handleSearchChange = useCallback((value: string) => {
      setSearch(value);
      setPagination((prev) => ({ ...prev, current: 1 }));
    }, []);

    const handleDiffFilterChange = useCallback((filter: 'all' | 'easy' | 'medium' | 'hard') => {
      setDiffFilter(filter);
      setPagination((prev) => ({ ...prev, current: 1 }));
    }, []);

    const handleDeleteCase = useCallback(
      (testCase: any) => {
        modal.confirm({
          content: t('testCase.delete.confirm'),
          okButtonProps: { danger: true },
          okText: t('common.delete'),
          onOk: async () => {
            try {
              await agentEvalService.deleteTestCase(testCase.id);
              message.success(t('testCase.delete.success'));
              if (expandedDs) await refreshTestCases(expandedDs);
              onRefresh();
            } catch {
              message.error(t('testCase.delete.error'));
            }
          },
          title: t('common.delete'),
        });
      },
      [expandedDs, message, modal, onRefresh, refreshTestCases, t],
    );

    return (
      <>
        <Flexbox gap={16}>
          {datasets.length > 0 && (
            <Flexbox horizontal align="center" justify="space-between">
              <p style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 14, margin: 0 }}>
                {t('benchmark.detail.datasetCount', { count: datasets.length })}
              </p>
              <Button icon={Plus} size="small" type="primary" onClick={() => setCreateOpen(true)}>
                {t('dataset.actions.addDataset')}
              </Button>
            </Flexbox>
          )}

          {datasetsLoading && datasets.length === 0 ? (
            <Flexbox gap={12}>
              {[1, 2, 3].map((i) => (
                <Card className={loadingStyles.card} key={i}>
                  <div className={loadingStyles.header}>
                    <div className={loadingStyles.icon} />
                    <Flexbox flex={1} gap={6}>
                      <Skeleton.Input active size="small" style={{ height: 16, width: 120 }} />
                      <Skeleton.Input active size="small" style={{ height: 12, width: 200 }} />
                    </Flexbox>
                    <Skeleton.Input active size="small" style={{ height: 14, width: 50 }} />
                    <Skeleton.Button active size="small" style={{ height: 28, width: 64 }} />
                  </div>
                </Card>
              ))}
            </Flexbox>
          ) : datasets.length === 0 ? (
            <EmptyState onAddDataset={() => setCreateOpen(true)} />
          ) : (
            <Flexbox gap={12}>
              {datasets.map((ds) => {
                const isExpanded = expandedDs === ds.id;
                return (
                  <DatasetCard
                    benchmarkId={benchmarkId}
                    dataset={ds}
                    diffFilter={diffFilter}
                    filteredCases={isExpanded ? filteredCases : []}
                    isExpanded={isExpanded}
                    key={ds.id}
                    loading={isExpanded ? loading : false}
                    pagination={pagination}
                    search={search}
                    total={isExpanded ? total : 0}
                    onAddCase={() => setAddCaseDatasetId(ds.id)}
                    onDeleteCase={handleDeleteCase}
                    onDiffFilterChange={handleDiffFilterChange}
                    onEdit={setEditDataset}
                    onExpand={() => handleExpand(ds.id)}
                    onImport={() => setImportDatasetId(ds.id)}
                    onPageChange={(page, pageSize) => setPagination({ current: page, pageSize })}
                    onRefresh={onRefresh}
                    onRun={() => setRunDatasetId(ds.id)}
                    onSearchChange={handleSearchChange}
                  />
                );
              })}
            </Flexbox>
          )}
        </Flexbox>

        {/* Edit Dataset Modal */}
        {editDataset && (
          <DatasetEditModal
            dataset={editDataset}
            open={!!editDataset}
            onCancel={() => setEditDataset(null)}
            onSuccess={onRefresh}
          />
        )}

        {/* Create Dataset Modal */}
        <DatasetCreateModal
          benchmarkId={benchmarkId}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={(dataset) => {
            onRefresh();
            // Ask if user wants to import data immediately
            modal.success({
              cancelText: t('common.later'),
              content: t('dataset.create.importNow'),
              okCancel: true,
              okText: t('dataset.actions.import'),
              onOk: () => {
                setImportDatasetId(dataset.id);
              },
              title: t('dataset.create.successTitle'),
            });
          }}
        />

        {/* Import Dataset Modal */}
        <DatasetImportModal
          datasetId={importDatasetId!}
          open={!!importDatasetId}
          presetId={datasets.find((ds) => ds.id === importDatasetId)?.metadata?.preset}
          onClose={() => setImportDatasetId(null)}
          onSuccess={handleRefreshTestCases}
        />

        {/* Add Test Case Modal */}
        <TestCaseCreateModal
          datasetId={addCaseDatasetId!}
          open={!!addCaseDatasetId}
          onClose={() => setAddCaseDatasetId(null)}
          onSuccess={handleRefreshTestCases}
        />

        {/* Create Run Modal */}
        <RunCreateModal
          benchmarkId={benchmarkId}
          datasetId={runDatasetId!}
          datasetName={datasets.find((ds) => ds.id === runDatasetId)?.name || ''}
          open={!!runDatasetId}
          onClose={() => setRunDatasetId(null)}
        />
      </>
    );
  },
);

export default DatasetsTab;
