'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { App, Typography } from 'antd';
import { ArrowLeft, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { agentEvalService } from '@/services/agentEval';
import { runSelectors, useEvalStore } from '@/store/eval';

import DatasetEditModal from '../../../../features/DatasetEditModal';
import DatasetImportModal from '../../../../features/DatasetImportModal';
import TestCaseCreateModal from '../../../../features/TestCaseCreateModal';
import TestCaseEditModal from '../../../../features/TestCaseEditModal';
import TestCasePreviewPanel from '../../features/DatasetsTab/TestCasePreviewPanel';
import TestCaseTable from '../../features/DatasetsTab/TestCaseTable';
import RunCreateModal from '../../features/RunCreateModal';
import EmptyState from '../../features/RunsTab/EmptyState';
import RunCard from '../../features/RunsTab/RunCard';

const DatasetDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId, datasetId } = useParams<{ benchmarkId: string; datasetId: string }>();
  const navigate = useNavigate();
  const { modal, message } = App.useApp();

  const [pagination, setPagination] = useState({ current: 1, pageSize: 10 });
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [previewCase, setPreviewCase] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addCaseOpen, setAddCaseOpen] = useState(false);
  const [createRunOpen, setCreateRunOpen] = useState(false);

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
      modal.confirm({
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
    [handleRefresh, message, modal, t],
  );

  const handleDelete = useCallback(() => {
    modal.confirm({
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
  }, [benchmarkId, datasetId, message, modal, navigate, t]);

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
          <Link
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
          </Link>

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
                onClick={() => setEditOpen(true)}
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
                diffFilter={diffFilter}
                pagination={pagination}
                search={search}
                selectedId={previewCase?.id}
                testCases={filteredCases}
                total={total}
                onAddCase={() => setAddCaseOpen(true)}
                onDelete={handleDeleteCase}
                onEdit={setEditingCase}
                onImport={() => setImportOpen(true)}
                onPageChange={(page, pageSize) => setPagination({ current: page, pageSize })}
                onPreview={setPreviewCase}
                onDiffFilterChange={(f) => {
                  setDiffFilter(f);
                  setPagination((prev) => ({ ...prev, current: 1 }));
                }}
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
              <Button icon={Plus} size="small" onClick={() => setCreateRunOpen(true)}>
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
              <EmptyState onCreate={() => setCreateRunOpen(true)} />
            )}
          </Flexbox>
        </Flexbox>

        {previewCase && (
          <TestCasePreviewPanel testCase={previewCase} onClose={() => setPreviewCase(null)} />
        )}
      </Flexbox>

      {editOpen && (
        <DatasetEditModal
          dataset={dataset}
          open={editOpen}
          onCancel={() => setEditOpen(false)}
          onSuccess={handleRefresh}
        />
      )}

      <DatasetImportModal
        datasetId={datasetId!}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={handleRefresh}
      />

      <TestCaseCreateModal
        datasetId={datasetId!}
        open={addCaseOpen}
        onClose={() => setAddCaseOpen(false)}
        onSuccess={handleRefresh}
      />

      {editingCase && (
        <TestCaseEditModal
          open={!!editingCase}
          testCase={editingCase}
          onClose={() => setEditingCase(null)}
          onSuccess={handleRefresh}
        />
      )}

      <RunCreateModal
        benchmarkId={benchmarkId!}
        datasetId={datasetId!}
        datasetName={dataset.name}
        open={createRunOpen}
        onClose={() => setCreateRunOpen(false)}
      />
    </>
  );
});

export default DatasetDetail;
