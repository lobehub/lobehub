'use client';

import { Button, confirmModal, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowLeft, Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { agentEvalService } from '@/services/agentEval';
import { runSelectors, testCaseSelectors, useEvalStore } from '@/store/eval';

import TestCasePreviewPanel from '../../bench/[benchmarkId]/features/DatasetsTab/TestCasePreviewPanel';
import TestCaseTable from '../../bench/[benchmarkId]/features/DatasetsTab/TestCaseTable';
import { createRunCreateModal } from '../../bench/[benchmarkId]/features/RunCreateModal';
import EmptyState from '../../bench/[benchmarkId]/features/RunsTab/EmptyState';
import RunCard from '../../bench/[benchmarkId]/features/RunsTab/RunCard';
import { createDatasetEditModal } from '../../features/DatasetEditModal';
import { createDatasetImportModal } from '../../features/DatasetImportModal';
import SegmentBar from '../../features/SegmentBar';
import { createTestCaseCreateModal } from '../../features/TestCaseCreateModal';
import { createTestCaseEditModal } from '../../features/TestCaseEditModal';

const styles = stylex.create({
  backLink: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    width: 'fit-content',
    fontSize: cssVar.fontSize,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    textDecoration: 'none',
    transition: {
      'default': 'color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  header: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorPrimaryBg,
    backgroundImage: 'none',
  },
  heroBand: {
    padding: '20px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  heroValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeHeading2,
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorText,
  },
  summaryDot: { width: '8px', height: '8px', borderRadius: '999px' },
  tableWrapper: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
});

const DatasetDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useWorkspaceAwareNavigate();

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
  const deleteDataset = useEvalStore((s) => s.deleteDataset);

  const { data: dataset, error, isLoading, mutate } = useFetchDatasetDetail(datasetId);
  // Nullable: a dataset accumulated from captured cases belongs to no benchmark.
  const benchmarkId: string | null =
    (dataset as { benchmarkId?: string | null })?.benchmarkId ?? null;
  useFetchDatasetRuns(datasetId);

  const sortedRuns = useMemo(
    () =>
      [...runList].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [runList],
  );

  // One query for the fetch and the read: the rows only show for this exact page.
  const caseQuery = {
    datasetId: datasetId!,
    limit: pagination.pageSize,
    offset: (pagination.current - 1) * pagination.pageSize,
  };
  useFetchTestCases(caseQuery);

  const testCases = useEvalStore(testCaseSelectors.testCases(caseQuery));
  const total = useEvalStore(testCaseSelectors.testCaseTotal(caseQuery));

  const filteredCases = testCases.filter((c: any) => {
    if (diffFilter !== 'all' && c.metadata?.difficulty !== diffFilter) return false;
    if (search && !c.content?.input?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Difficulty mix across the loaded cases — feeds the summary hero's bar.
  const difficulty = useMemo(() => {
    const counts = { easy: 0, hard: 0, medium: 0 };
    for (const c of testCases as any[]) {
      const d = c?.metadata?.difficulty as 'easy' | 'hard' | 'medium' | undefined;
      if (d === 'easy' || d === 'medium' || d === 'hard') counts[d] += 1;
    }
    return {
      counts,
      segments: [
        { color: cssVar.colorSuccess, value: counts.easy },
        { color: cssVar.colorWarning, value: counts.medium },
        { color: cssVar.colorError, value: counts.hard },
      ],
      tagged: counts.easy + counts.medium + counts.hard,
    };
  }, [testCases]);

  const handleRefresh = useCallback(async () => {
    if (datasetId) {
      await refreshTestCases();
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
            toast.success(t('testCase.delete.success'));
            await handleRefresh();
          } catch {
            toast.error(t('testCase.delete.error'));
          }
        },
        title: t('common.delete'),
      });
    },
    [handleRefresh, t],
  );

  const handleDelete = useCallback(() => {
    confirmModal({
      content: t('dataset.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await deleteDataset(datasetId!);
          toast.success(t('dataset.delete.success'));
          navigate(benchmarkId ? `/eval/bench/${benchmarkId}` : '/eval');
        } catch {
          toast.error(t('dataset.delete.error'));
        }
      },
      title: t('common.delete'),
    });
  }, [benchmarkId, datasetId, deleteDataset, navigate, t]);

  // Skeleton → error → (resolved-null) blank, replacing a bare `return null`
  // that flashed blank on the happy path and stayed permanently blank on a
  // failed fetch (ux Read §1.1). A page-level failure gets a reason + Reload.
  return (
    <AsyncBoundary
      data={dataset}
      error={error}
      errorVariant={'page'}
      isEmpty={!dataset}
      isLoading={isLoading}
      loading={<RouteLoading />}
      onRetry={() => mutate()}
    >
      {dataset && (
        <Flexbox horizontal style={{ flex: 1, minHeight: 0 }}>
          <Flexbox
            flex={1}
            gap={24}
            style={{ minWidth: 0, overflow: 'auto', paddingBlock: 24, paddingInline: 32 }}
          >
            {/* Back link */}
            <WorkspaceLink
              className={stylex.props(styles.backLink).className}
              to={benchmarkId ? `/eval/bench/${benchmarkId}` : '/eval'}
            >
              <ArrowLeft size={16} />
              {benchmarkId ? t('dataset.detail.backToBenchmark') : t('dataset.detail.backToEval')}
            </WorkspaceLink>

            {/* Header */}
            <Flexbox horizontal align="start" justify="space-between">
              <Flexbox horizontal align="start" gap={12}>
                <div {...stylex.props(styles.header)}>
                  <Database size={20} style={{ color: cssVar.colorPrimary }} />
                </div>
                <Flexbox gap={4}>
                  <Text as="h4" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                    {dataset.name}
                  </Text>
                  {dataset.description && <Text type="secondary">{dataset.description}</Text>}
                </Flexbox>
              </Flexbox>

              <Flexbox horizontal gap={8}>
                <Button
                  icon={Pencil}
                  size="small"
                  onClick={() => createDatasetEditModal({ dataset, onSuccess: handleRefresh })}
                >
                  {t('common.edit')}
                </Button>
                <Button danger icon={Trash2} size="small" onClick={handleDelete}>
                  {t('common.delete')}
                </Button>
              </Flexbox>
            </Flexbox>

            {/* Summary hero — headline case count + difficulty mix */}
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.heroBand).className}
              gap={16}
              justify="space-between"
            >
              <Flexbox gap={6}>
                <span {...stylex.props(styles.heroValue)}>{total}</span>
                <Text color={cssVar.colorTextTertiary} fontSize={12}>
                  {t('dataset.detail.testCases')}
                </Text>
              </Flexbox>
              {difficulty.tagged > 0 && (
                <Flexbox gap={8} style={{ maxWidth: 280, minWidth: 0, width: '100%' }}>
                  <SegmentBar segments={difficulty.segments} />
                  <Flexbox horizontal gap={12} justify="flex-end" style={{ flexWrap: 'wrap' }}>
                    {(['easy', 'medium', 'hard'] as const).map((d) => (
                      <Flexbox horizontal align="center" gap={6} key={d}>
                        <span
                          className={stylex.props(styles.summaryDot).className}
                          style={{
                            background:
                              d === 'easy'
                                ? cssVar.colorSuccess
                                : d === 'medium'
                                  ? cssVar.colorWarning
                                  : cssVar.colorError,
                          }}
                        />
                        <Text color={cssVar.colorTextTertiary} fontSize={12}>
                          {t(`difficulty.${d}`)} {difficulty.counts[d]}
                        </Text>
                      </Flexbox>
                    ))}
                  </Flexbox>
                </Flexbox>
              )}
            </Flexbox>

            {/* Test Cases */}
            <Flexbox gap={12}>
              <Flexbox horizontal align="center" justify="space-between">
                <Text weight={600}>{t('dataset.detail.testCases')}</Text>
                <Text type="secondary">{t('dataset.detail.caseCount', { count: total })}</Text>
              </Flexbox>

              <div {...stylex.props(styles.tableWrapper)}>
                <TestCaseTable
                  datasetEvalMode={dataset?.evalMode}
                  diffFilter={diffFilter}
                  pagination={pagination}
                  search={search}
                  selectedId={previewCase?.id}
                  testCases={filteredCases}
                  total={total}
                  onDelete={handleDeleteCase}
                  onOpen={(testCase: any) => navigate(`/eval/cases/${testCase.id}`)}
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

            {/* Related Runs. A run belongs to a benchmark by design — that is
                what defines the shared rubrics it is scored against — so a
                dataset that belongs to none has nothing to run against yet. */}
            {benchmarkId ? (
              <Flexbox gap={12}>
                <Flexbox horizontal align="center" justify="space-between">
                  <Text weight={600}>
                    {t('dataset.detail.relatedRuns', { count: sortedRuns.length })}
                  </Text>
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
            ) : (
              <Text color={cssVar.colorTextTertiary} fontSize={12}>
                {t('dataset.detail.runsNeedBenchmark')}
              </Text>
            )}
          </Flexbox>

          {previewCase && (
            <TestCasePreviewPanel testCase={previewCase} onClose={() => setPreviewCase(null)} />
          )}
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default DatasetDetail;
