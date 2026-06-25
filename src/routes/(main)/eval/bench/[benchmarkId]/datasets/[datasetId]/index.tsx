'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App, Typography } from 'antd';
import { ArrowLeft, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { agentEvalService } from '@/services/agentEval';
import { runSelectors, useEvalStore } from '@/store/eval';

import { createDatasetEditModal } from '../../../../features/DatasetEditModal';
import { createDatasetImportModal } from '../../../../features/DatasetImportModal';
import { createTestCaseCreateModal } from '../../../../features/TestCaseCreateModal';
import { createTestCaseEditModal } from '../../../../features/TestCaseEditModal';
import TestCasePreviewPanel from '../../features/DatasetsTab/TestCasePreviewPanel';
import TestCaseTable from '../../features/DatasetsTab/TestCaseTable';
import { createRunCreateModal } from '../../features/RunCreateModal';
import EmptyState from '../../features/RunsTab/EmptyState';
import RunCard from '../../features/RunsTab/RunCard';

const DatasetDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId, datasetId } = useParams<{ benchmarkId: string; datasetId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const { message } = App.useApp();

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [previewCase, setPreviewCase] = useState<any | null>(null);

  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
  const useFetchDatasetRuns = useEvalStore((s) => s.useFetchDatasetRuns);
  const runList = useEvalStore(runSelectors.datasetRunList(datasetId!));
  const refreshTestCases = useEvalStore((s) => s.refreshTestCases);
  const refreshDatasetDetail = useEvalStore((s) => s.refreshDatasetDetail);

  const { data: dataset } = useFetchDatasetDetail(datasetId);
  useFetchDatasetRuns(datasetId);

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runList],
  );

  const { data: testCaseData } = useFetchTestCases({
    datasetId: datasetId!,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  });

  const testCases = testCaseData?.data || [];
  const total = testCaseData?.total || 0;

  const filteredCases = testCases.filter((c: any) => {
    if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
    if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleRefresh = useCallback(async () => {
    if (datasetId) {
      await refreshTestCases(datasetId);
      await refreshDatasetDetail(datasetId);
    }
  }, [datasetId, refreshTestCases, refreshDatasetDetail]);

  const handleDeleteCase = useCallback(
    (testCase: any) => {
      confirmModal({
        content: t('testCase.delete.confirm'),
        okButtonProps: { danger: true },
        okText: t('common.delete'),
        onOk: async () => {
          try {
            await agentEvalService.deleteTestCase(testCase.id);
            message.success(t('testCase.delete.success'));
            await handleRefresh();
          } catch {
            message.error(t('testCase.delete.error'));
          }
        },
        title: t('common.delete'),
      });
    },
    [handleRefresh, message, t],
  );

  const handleDelete = useCallback(() => {
    confirmModal({
      content: t('dataset.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteDataset(datasetId!);
          message.success(t('dataset.delete.success'));
          navigate(`/eval/bench/${benchmarkId}`);
        } catch {
          message.error(t('dataset.delete.error'));
        }
      },
      title: t('common.delete'),
    });
  }, [benchmarkId, datasetId, message, navigate, t]);

  if (!dataset) return null;

  return (
    <>
      <Flexbox horizontal style={{ flex: 1, minHeight: 0 }}>
        <Flexbox
          flex={1}
          gap={24}
          style={{ minWidth: 0, overflow: 'auto', paddingBlock: 24, paddingInline: 32 }}
        >
          {/* Back link */}
          <WorkspaceLink
            to={`/eval/bench/${benchmarkId}`}
            style={{
              alignItems: 'center',
              color: 'var(--ant-color-text-tertiary)',
              display: 'inline-flex',
              fontSize: 14,
              gap: 4,
              textDecoration: 'none',
              transition: 'color 0.2s',
              width: 'fit-content',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--ant-color-text)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--ant-color-text-tertiary)';
            }}
          >
            <ArrowLeft size={16} />
            {t('dataset.detail.backToBenchmark')}
          </WorkspaceLink>

          {/* Header */}
          <Flexbox horizontal align="start" justify="space-between">
            <Flexbox horizontal align="start" gap={12}>
              <div
                style={{
                  alignItems: 'center',
                  background: 'var(--ant-color-primary-bg)',
                  borderRadius: 10,
                  display: 'flex',
                  flexShrink: 0,
                  height: 40,
                  justifyContent: 'center',
                  width: 40,
                }}
              >
                <Database size={20} style={{ color: 'var(--ant-color-primary)' }} />
              </div>
              <Flexbox gap={4}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {dataset.name}
                </Typography.Title>
                {dataset.description && (
                  <Typography.Text type="secondary">{dataset.description}</Typography.Text>
                )}
              </Flexbox>
            </Flexbox>

            <Flexbox horizontal gap={8}>
              <Button
                icon={Pencil}
                size="small"
                variant="outlined"
                onClick={() => createDatasetEditModal({ dataset, onSuccess: handleRefresh })}
              >
                {t('common.edit')}
              </Button>
              <Button danger icon={Trash2} size="small" variant="outlined" onClick={handleDelete}>
                {t('common.delete')}
              </Button>
            </Flexbox>
          </Flexbox>

          {/* Test Cases */}
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between">
              <Typography.Text strong>{t('dataset.detail.testCases')}</Typography.Text>
              <Typography.Text type="secondary">
                {t('dataset.detail.caseCount', { count: total })}
              </Typography.Text>
            </Flexbox>

            <div
              style={{
                border: '1px solid var(--ant-color-border-secondary)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <TestCaseTable
                datasetEvalMode={dataset?.evalMode}
                diffFilter={diffFilter}
                pagination={pagination}
                search={search}
                selectedId={previewCase?.id}
                testCases={filteredCases}
                total={total}
                onDelete={handleDeleteCase}
                onPageChange={(page, pageSize) => setPagination({ current: page, pageSize })}
                onPreview={setPreviewCase}
                onAddCase={() =>
                  createTestCaseCreateModal({ datasetId: datasetId!, onSuccess: handleRefresh })
                }
                onDiffFilterChange={(f) => {
                  setDiffFilter(f);
                  setPagination((prev) => ({ ...prev, current: 1 }));
                }}
                onEdit={(testCase) =>
                  createTestCaseEditModal({ onSuccess: handleRefresh, testCase })
                }
                onImport={() =>
                  createDatasetImportModal({ datasetId: datasetId!, onSuccess: handleRefresh })
                }
                onSearchChange={(v) => {
                  setSearch(v);
                  setPagination((prev) => ({ ...prev, current: 1 }));
                }}
              />
            </div>
          </Flexbox>

          {/* Related Runs */}
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between">
              <Typography.Text strong>
                {t('dataset.detail.relatedRuns', { count: sortedRuns.length })}
              </Typography.Text>
              <Button
                icon={Plus}
                size="small"
                onClick={() =>
                  createRunCreateModal({
                    benchmarkId: benchmarkId!,
                    datasetId: datasetId!,
                    datasetName: dataset.name,
                  })
                }
              >
                {t('dataset.detail.addRun')}
              </Button>
            </Flexbox>
            {sortedRuns.length > 0 ? (
              <Flexbox gap={12}>
                {sortedRuns.map((run) => (
                  <RunCard benchmarkId={benchmarkId!} key={run.id} run={run} />
                ))}
              </Flexbox>
            ) : (
              <EmptyState
                onCreate={() =>
                  createRunCreateModal({
                    benchmarkId: benchmarkId!,
                    datasetId: datasetId!,
                    datasetName: dataset.name,
                  })
                }
              />
            )}
          </Flexbox>
        </Flexbox>

        {previewCase && (
          <TestCasePreviewPanel testCase={previewCase} onClose={() => setPreviewCase(null)} />
        )}
      </Flexbox>
    </>
  );
});

export default DatasetDetail;
