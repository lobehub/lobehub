'use client';

import { Flexbox } from '@lobehub/ui';
import { Breadcrumb, Button, Skeleton, SkeletonText, toast } from '@lobehub/ui/base-ui';
import { GitCompareArrows, RotateCcw, RotateCw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { diagnoseCase } from '@/features/Eval/components/diagnosis';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalPage, { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import EvalSection from '@/features/Eval/components/EvalSection';
import { StatGrid, StatTile } from '@/features/Eval/components/StatTile';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';
import { isTrpcErrorCode } from '@/utils/trpcError';

import StatusBadge from '../StatusBadge';
import { formatDuration } from '../utils';
import CellDetailDrawer from './CellDetailDrawer';
import ComparisonMatrix from './ComparisonMatrix';
import { DIAGNOSIS_COLORS } from './DiagnosisTag';
import RunConfig from './RunConfig';
import { styles } from './style';
import TargetSummary from './TargetSummary';
import {
  type ComparisonCase,
  type ComparisonCell,
  gridProgress,
  indexCells,
  rankTargets,
  resolveTargets,
  summarizeTargets,
  tallyDiagnoses,
} from './utils';

const formatTime = (value?: Date | string | null) =>
  value ? new Date(value).toLocaleString() : undefined;

const DIAGNOSIS_ORDER = ['harness', 'model', 'pass', 'inconclusive'] as const;

const ComparisonSkeleton = () => (
  <EvalPage
    header={
      <Flexbox gap={12}>
        <SkeletonText rows={1} width={220} />
        <Skeleton height={28} radius={6} width="50%" />
        <SkeletonText rows={1} width={360} />
      </Flexbox>
    }
  >
    <Flexbox horizontal gap={12}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton height={76} key={i} radius={8} style={{ flex: 1 }} />
      ))}
    </Flexbox>
    <Skeleton height={420} radius={8} width="100%" />
  </EvalPage>
);

/**
 * A replay run read as a case × model matrix: each case's diagnosis (harness
 * or model choice), each model's pass rate, and every answer with the
 * judge's verdict on it.
 */
const ComparisonPage = memo(() => {
  const { t } = useTranslation('eval');
  const { runId } = useParams<{ runId: string }>();

  const useFetchReplayComparison = useEvalStore((s) => s.useFetchReplayComparison);
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const retryErrors = useEvalStore((s) => s.retryReplayComparisonErrors);

  const { data, error, isLoading, isValidating, mutate } = useFetchReplayComparison(runId);
  const { data: dataset } = useFetchDatasetDetail(data?.run.datasetId);

  const [openCellId, setOpenCellId] = useState<string>();
  const [retrying, setRetrying] = useState(false);

  const cells = useMemo(() => (data?.cells ?? []) as ComparisonCell[], [data]);
  const cases = useMemo(() => (data?.cases ?? []) as ComparisonCase[], [data]);
  const cellIndex = useMemo(() => indexCells(cells), [cells]);
  const summaries = useMemo(() => {
    const targets = resolveTargets(data?.targets ?? [], cells);
    return rankTargets(summarizeTargets(targets, cells, data?.run.metrics?.byTarget));
  }, [data, cells]);
  // Columns follow the ranking so the best model reads first.
  const targets = useMemo(
    () => summaries.map(({ model, provider }) => ({ model, provider })),
    [summaries],
  );
  const tally = useMemo(
    () =>
      tallyDiagnoses(
        cases.map((c) => diagnoseCase([...(cellIndex.get(c.id)?.values() ?? [])]).diagnosis),
      ),
    [cases, cellIndex],
  );

  const openCell = cells.find((c) => c.id === openCellId);
  const openCase = openCell && cases.find((c) => c.id === openCell.testCaseId);
  const isRunning = data?.run.status === 'running' || data?.run.status === 'pending';
  const progress = gridProgress(cells, cases.length * targets.length);

  // A deleted run, or an id that is not a replay run, is an absent resource:
  // offering Retry on it would loop forever.
  const isMissing = isTrpcErrorCode(error, 'NOT_FOUND') || isTrpcErrorCode(error, 'BAD_REQUEST');

  const handleRetryErrors = async () => {
    if (!runId) return;
    setRetrying(true);
    try {
      const { cellCount } = await retryErrors(runId);
      toast.success(t('comparison.retryErrors.success', { count: cellCount }));
    } catch (e) {
      toast.error((e as Error)?.message ?? t('comparison.retryErrors.failed'));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AsyncBoundary
      data={isMissing ? null : data}
      error={isMissing ? undefined : error}
      errorVariant={'page'}
      isEmpty={isMissing || !data}
      isLoading={isLoading}
      loading={<ComparisonSkeleton />}
      empty={
        <EvalPage>
          <EvalEmpty
            icon={GitCompareArrows}
            title={t('comparison.notFound')}
            action={
              <WorkspaceLink to="/eval">
                <Button>{t('testCaseDetail.breadcrumb.eval')}</Button>
              </WorkspaceLink>
            }
          />
        </EvalPage>
      }
      onRetry={() => mutate()}
    >
      {data && (
        <EvalPage
          header={
            <EvalPageHeader
              title={data.run.name || t('comparison.title')}
              actions={
                <>
                  {progress.errored > 0 && !isRunning && (
                    <Button icon={RotateCcw} loading={retrying} onClick={handleRetryErrors}>
                      {t('comparison.retryErrors', { count: progress.errored })}
                    </Button>
                  )}
                  <Button
                    data-testid="comparison-refresh"
                    icon={RotateCw}
                    loading={isValidating}
                    onClick={() => mutate()}
                  >
                    {t('comparison.refresh')}
                  </Button>
                </>
              }
              breadcrumb={
                <Breadcrumb
                  className={styles.breadcrumb}
                  items={[
                    {
                      title: (
                        <WorkspaceLink to="/eval">
                          {t('testCaseDetail.breadcrumb.eval')}
                        </WorkspaceLink>
                      ),
                    },
                    {
                      title: (
                        <WorkspaceLink to={`/eval/datasets/${data.run.datasetId}`}>
                          {dataset?.name || t('testCaseDetail.breadcrumb.dataset')}
                        </WorkspaceLink>
                      ),
                    },
                    { title: t('comparison.title') },
                  ]}
                />
              }
              meta={
                <Flexbox
                  horizontal
                  align="center"
                  className={styles.configLabel}
                  gap={12}
                  wrap="wrap"
                >
                  <StatusBadge status={data.run.status} />
                  {isRunning && (
                    <span className={styles.mono}>
                      {t('comparison.progress', {
                        settled: progress.settled,
                        total: progress.total,
                      })}
                    </span>
                  )}
                  <span>
                    {t('comparison.createdAt', {
                      time: formatTime(data.run.startedAt ?? data.run.createdAt),
                    })}
                  </span>
                  {typeof data.run.metrics?.duration === 'number' && (
                    <span>
                      {t('comparison.duration', {
                        duration: formatDuration(data.run.metrics.duration),
                      })}
                    </span>
                  )}
                </Flexbox>
              }
            />
          }
        >
          {cells.length === 0 ? (
            <EvalEmpty
              icon={GitCompareArrows}
              title={isRunning ? t('comparison.empty.running') : t('comparison.empty')}
            />
          ) : (
            <>
              <EvalSection
                description={t('comparison.tally.desc')}
                title={t('comparison.tally.title')}
              >
                <StatGrid>
                  {DIAGNOSIS_ORDER.map((d) => (
                    <StatTile
                      hint={t(`comparison.tally.${d}`)}
                      key={d}
                      label={t(`comparison.diagnosis.${d}`)}
                      value={
                        <span style={{ color: tally[d] ? DIAGNOSIS_COLORS[d] : undefined }}>
                          {tally[d]}
                        </span>
                      }
                    />
                  ))}
                </StatGrid>
              </EvalSection>

              <EvalSection count={targets.length} title={t('comparison.summary.title')}>
                <TargetSummary summaries={summaries} />
              </EvalSection>

              <EvalSection
                count={cases.length}
                description={t('comparison.cases.hint')}
                title={t('comparison.matrix.title')}
              >
                <ComparisonMatrix
                  cases={cases}
                  cellIndex={cellIndex}
                  summaries={summaries}
                  targets={targets}
                  onOpenCell={(cell) => setOpenCellId(cell.id)}
                />
              </EvalSection>
            </>
          )}

          <RunConfig
            caseCount={cases.length}
            config={data.run.config}
            targetCount={targets.length}
          />

          <CellDetailDrawer
            cell={openCell}
            testCase={openCase}
            onClose={() => setOpenCellId(undefined)}
          />
        </EvalPage>
      )}
    </AsyncBoundary>
  );
});

ComparisonPage.displayName = 'EvalComparisonPage';

export default ComparisonPage;
