'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import EvalPage from '@/features/Eval/components/EvalPage';
import EvalSection from '@/features/Eval/components/EvalSection';
import { StatGrid } from '@/features/Eval/components/StatTile';
import { runSelectors, useEvalStore } from '@/store/eval';

import CaseResultsTable from './CaseResultsTable';
import BenchmarkCharts from './Charts/BenchmarkCharts';
import { getResumeTarget } from './resumeTarget';
import RunHeader from './RunHeader';
import RunProgress from './RunProgress';
import RunStats from './RunStats';

const POLLING_INTERVAL = 3000;
const FINISHED = new Set(['completed', 'failed', 'aborted']);

const RunPageSkeleton = () => (
  <EvalPage
    header={
      <Flexbox gap={12}>
        <Skeleton height={14} width={120} />
        <Skeleton height={28} width={320} />
        <Skeleton height={16} width={480} />
      </Flexbox>
    }
  >
    <StatGrid>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton height={78} key={i} radius={12} width="100%" />
      ))}
    </StatGrid>
    <Skeleton height={280} radius={12} width="100%" />
    <Skeleton height={360} radius={12} width="100%" />
  </EvalPage>
);

const RunPage = () => {
  const { t } = useTranslation('eval');
  const { benchmarkId, runId } = useParams<{ benchmarkId: string; runId: string }>();
  const useFetchRunDetail = useEvalStore((s) => s.useFetchRunDetail);
  const useFetchRunResults = useEvalStore((s) => s.useFetchRunResults);
  const retryRunCase = useEvalStore((s) => s.retryRunCase);
  const resumeRunCase = useEvalStore((s) => s.resumeRunCase);
  const runDetail = useEvalStore(runSelectors.getRunDetailById(runId!));
  const runResults = useEvalStore(runSelectors.getRunResultsById(runId!));
  const isActive = useEvalStore(runSelectors.isRunActive(runId!));

  const pollingConfig = { refreshInterval: isActive ? POLLING_INTERVAL : 0 };
  const { error, isLoading, mutate } = useFetchRunDetail(runId!, pollingConfig);
  const results = useFetchRunResults(runId!, pollingConfig);

  const resultList: any[] = runResults?.results ?? [];
  const isFinished = !!runDetail && FINISHED.has(runDetail.status);
  const k = runDetail?.config?.k ?? 1;
  const metrics = runDetail?.metrics;
  const errorCount = (metrics?.errorCases ?? 0) + (metrics?.timeoutCases ?? 0);
  const provider = runDetail?.config?.subjectModel
    ? runDetail.config.subjectProvider
    : runDetail?.config?.agentSnapshot?.provider || runDetail?.targetAgent?.provider;

  return (
    <AsyncBoundary
      data={runDetail}
      error={error}
      errorVariant={'page'}
      isEmpty={!runDetail}
      isLoading={isLoading}
      loading={<RunPageSkeleton />}
      onRetry={() => mutate()}
    >
      {runDetail && (
        <EvalPage
          header={
            <RunHeader
              benchmarkId={benchmarkId!}
              canBatchResume={resultList.some((r) => !!getResumeTarget(r, k))}
              canRetryErrors={isFinished && errorCount > 0}
              run={runDetail}
            />
          }
        >
          {isFinished ? (
            <EvalSection title={t('run.detail.report')}>
              <RunStats k={k} metrics={metrics} />
              {resultList.length > 0 && (
                <BenchmarkCharts benchmarkId={benchmarkId!} results={resultList} runId={runId!} />
              )}
            </EvalSection>
          ) : (
            <RunProgress results={resultList} run={runDetail} />
          )}

          <EvalSection count={resultList.length || undefined} title={t('run.detail.caseResults')}>
            <AsyncBoundary
              data={runResults ?? results.data}
              error={results.error}
              isEmpty={!results.error && resultList.length === 0}
              isLoading={results.isLoading}
              loading={<Skeleton height={360} radius={12} width="100%" />}
              empty={
                <EvalEmpty
                  compact
                  description={t('run.results.empty.desc')}
                  icon={ListChecks}
                  title={t('run.results.empty.title')}
                />
              }
              onRetry={() => results.mutate()}
            >
              <CaseResultsTable
                benchmarkId={benchmarkId!}
                k={k}
                provider={provider}
                results={resultList}
                runId={runId!}
                runStatus={runDetail.status}
                onResumeCase={(testCaseId, threadId) => resumeRunCase(runId!, testCaseId, threadId)}
                onRetryCase={(testCaseId) => retryRunCase(runId!, testCaseId)}
              />
            </AsyncBoundary>
          </EvalSection>
        </EvalPage>
      )}
    </AsyncBoundary>
  );
};

export default RunPage;
