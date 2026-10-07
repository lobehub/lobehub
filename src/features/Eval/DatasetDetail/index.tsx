'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, confirmModal, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { ArrowLeft, Database, Ellipsis, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { createCompareModal } from '@/features/Eval/CompareModal';
import EvalPage, { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import { createDatasetEditModal } from '@/features/Eval/DatasetEditModal';
import { createDatasetImportModal } from '@/features/Eval/DatasetImportModal';
import { createTestCaseCreateModal } from '@/features/Eval/TestCaseCreateModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { agentEvalService } from '@/services/agentEval';
import { runSelectors, useEvalStore } from '@/store/eval';

import { type DatasetCase } from './CaseRow';
import CasesSection from './CasesSection';
import CompareButton from './CompareButton';
import ComparisonsSection, { type ComparisonRun } from './ComparisonsSection';
import DatasetSkeleton, { CaseListSkeleton } from './DatasetSkeleton';
import EmptyCases from './EmptyCases';
import RunsSection from './RunsSection';
import { styles } from './style';

/** The server caps a page at 100; one page covers nearly every captured dataset. */
const PAGE_SIZE = 100;

const DatasetDetail = () => {
  const { t } = useTranslation('eval');
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const [page, setPage] = useState(1);

  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
  const useFetchDatasetRuns = useEvalStore((s) => s.useFetchDatasetRuns);
  const refreshTestCases = useEvalStore((s) => s.refreshTestCases);
  const refreshDatasetDetail = useEvalStore((s) => s.refreshDatasetDetail);
  const refreshDatasetRuns = useEvalStore((s) => s.refreshDatasetRuns);
  const runList = useEvalStore(runSelectors.datasetRunList(datasetId!));

  const { data: dataset, error, isLoading, mutate } = useFetchDatasetDetail(datasetId);
  const offset = (page - 1) * PAGE_SIZE;
  const casesSWR = useFetchTestCases({ datasetId: datasetId!, limit: PAGE_SIZE, offset });
  const runsSWR = useFetchDatasetRuns(datasetId);

  // Nullable: a dataset accumulated from captured cases belongs to no benchmark.
  const benchmarkId: string | null =
    (dataset as { benchmarkId?: string | null } | undefined)?.benchmarkId ?? null;

  const cases: DatasetCase[] = casesSWR.data?.data ?? [];
  const total: number = casesSWR.data?.total ?? 0;
  const frozenCount = cases.filter((c) => c.hasFrozenCall).length;
  const canCompare = frozenCount > 0;

  // Replay runs are cross-model comparisons; the rest are agent runs that
  // open under their benchmark.
  const { agentRuns, comparisons } = useMemo(() => {
    const sorted = [...runList].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const isReplay = (run: any) => run.config?.executionMode === 'replay';
    return {
      agentRuns: sorted.filter((run) => !isReplay(run)),
      comparisons: sorted.filter(isReplay) as ComparisonRun[],
    };
  }, [runList]);

  const handleRefresh = useCallback(async () => {
    if (!datasetId) return;
    await Promise.all([refreshTestCases(datasetId), refreshDatasetDetail(datasetId)]);
  }, [datasetId, refreshTestCases, refreshDatasetDetail]);

  const openAdd = () =>
    createTestCaseCreateModal({ datasetId: datasetId!, onSuccess: handleRefresh });
  const openImport = () =>
    createDatasetImportModal({ datasetId: datasetId!, onSuccess: handleRefresh });
  const openCompare = () =>
    createCompareModal({
      datasetId: datasetId!,
      onStarted: (runId) => {
        void refreshDatasetRuns(datasetId!);
        navigate(`/eval/comparisons/${runId}`);
      },
    });

  const handleDelete = () => {
    confirmModal({
      content: t('dataset.delete.confirm'),
      okButtonProps: { danger: true },
      okText: t('common.delete'),
      onOk: async () => {
        try {
          await agentEvalService.deleteDataset(datasetId!);
          toast.success(t('dataset.delete.success'));
          navigate(benchmarkId ? `/eval/bench/${benchmarkId}` : '/eval');
        } catch {
          toast.error(t('dataset.delete.error'));
        }
      },
      title: t('dataset.delete.title'),
    });
  };

  const casesFallback =
    casesSWR.isLoading && !casesSWR.data ? (
      <CaseListSkeleton />
    ) : casesSWR.error && !casesSWR.data ? (
      <AsyncError error={casesSWR.error} onRetry={() => casesSWR.mutate()} />
    ) : undefined;
  const isEmptyDataset = !!casesSWR.data && total === 0;

  return (
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'auto' }}>
      <AsyncBoundary
        data={dataset}
        error={error}
        errorVariant={'page'}
        isEmpty={!dataset}
        isLoading={isLoading}
        loading={<DatasetSkeleton />}
        onRetry={() => mutate()}
      >
        {dataset && (
          <EvalPage
            header={
              <EvalPageHeader
                description={dataset.description || undefined}
                title={dataset.name}
                actions={
                  <>
                    {/* An empty dataset's own empty state carries add / import. */}
                    {total > 0 && (
                      <>
                        <Button icon={FileUp} onClick={openImport}>
                          {t('dataset.actions.import')}
                        </Button>
                        <Button icon={Plus} onClick={openAdd}>
                          {t('testCase.actions.add')}
                        </Button>
                        <CompareButton enabled={canCompare} onClick={openCompare} />
                      </>
                    )}
                    <DropdownMenu
                      items={[
                        {
                          icon: <Pencil size={14} />,
                          key: 'edit',
                          label: t('common.edit'),
                          onClick: () =>
                            createDatasetEditModal({ dataset, onSuccess: handleRefresh }),
                        },
                        { type: 'divider' },
                        {
                          danger: true,
                          icon: <Trash2 size={14} />,
                          key: 'delete',
                          label: t('common.delete'),
                          onClick: handleDelete,
                        },
                      ]}
                    >
                      <ActionIcon icon={Ellipsis} title={t('dataset.actions.more')} />
                    </DropdownMenu>
                  </>
                }
                breadcrumb={
                  <WorkspaceLink
                    className={styles.breadcrumbLink}
                    to={benchmarkId ? `/eval/bench/${benchmarkId}` : '/eval'}
                  >
                    <Flexbox horizontal align="center" gap={4}>
                      <ArrowLeft size={14} />
                      {benchmarkId
                        ? t('dataset.detail.backToBenchmark')
                        : t('dataset.detail.backToEval')}
                    </Flexbox>
                  </WorkspaceLink>
                }
                icon={
                  <div className={styles.icon}>
                    <Database size={20} />
                  </div>
                }
                meta={
                  casesSWR.data && (
                    <Flexbox horizontal align="center" className={styles.meta} gap={8} wrap="wrap">
                      <span>{t('dataset.detail.caseCount', { count: total })}</span>
                      {total > 0 && (
                        <>
                          <span className={styles.metaDot}>·</span>
                          <span>
                            {t('dataset.meta.frozen', {
                              count: frozenCount,
                              more: total > cases.length ? '+' : '',
                            })}
                          </span>
                        </>
                      )}
                    </Flexbox>
                  )
                }
              />
            }
          >
            {isEmptyDataset ? (
              <EmptyCases onAdd={openAdd} onImport={openImport} />
            ) : (
              <CasesSection
                cases={cases}
                fallback={casesFallback}
                offset={offset}
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={setPage}
                onRefresh={handleRefresh}
              />
            )}

            {runsSWR.isLoading && !runsSWR.data ? (
              <CaseListSkeleton rows={2} />
            ) : runsSWR.error && !runsSWR.data ? (
              <AsyncError
                error={runsSWR.error}
                variant={'block'}
                onRetry={() => runsSWR.mutate()}
              />
            ) : (
              !isEmptyDataset &&
              runsSWR.data !== undefined && (
                <ComparisonsSection
                  runs={comparisons}
                  onCompare={canCompare ? openCompare : undefined}
                />
              )
            )}

            {benchmarkId && !isEmptyDataset && runsSWR.data !== undefined && (
              <RunsSection
                benchmarkId={benchmarkId}
                datasetId={datasetId!}
                datasetName={dataset.name}
                runs={agentRuns}
              />
            )}
          </EvalPage>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
};

export default DatasetDetail;
