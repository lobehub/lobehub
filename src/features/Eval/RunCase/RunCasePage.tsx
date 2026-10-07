'use client';

import type { EvalThreadResult } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Skeleton, SkeletonText, Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileQuestion, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import { getCaseVerdict } from '@/features/Eval/Run/verdict';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { runSelectors, useEvalStore } from '@/store/eval';

import CaseBanner from './CaseBanner';
import ChatArea from './ChatArea';
import InfoSidebar from './InfoSidebar';

const POLLING_INTERVAL = 3000;

const styles = createStaticStyles(({ css }) => ({
  tabs: css`
    flex: none;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const RunCaseSkeleton = () => (
  <Flexbox height="100%">
    <Flexbox
      gap={10}
      padding={24}
      style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}` }}
    >
      <Skeleton height={14} width={140} />
      <Skeleton height={24} width={220} />
      <Skeleton height={14} width={420} />
    </Flexbox>
    <Flexbox horizontal flex={1}>
      <Flexbox flex={1} gap={24} padding={24}>
        <SkeletonText rows={3} />
        <SkeletonText rows={4} />
      </Flexbox>
      <Flexbox gap={16} padding={16} style={{ width: 320 }}>
        <SkeletonText rows={4} />
        <Skeleton height={72} radius={8} width="100%" />
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

const RunCasePage = () => {
  const { benchmarkId, runId, caseId } = useParams<{
    benchmarkId: string;
    caseId: string;
    runId: string;
  }>();
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const useFetchRunDetail = useEvalStore((s) => s.useFetchRunDetail);
  const useFetchRunResults = useEvalStore((s) => s.useFetchRunResults);
  const isActive = useEvalStore(runSelectors.isRunActive(runId!));

  // Ensure data is loaded even when navigating directly to this URL
  const pollingConfig = { refreshInterval: isActive ? POLLING_INTERVAL : 0 };
  useFetchRunDetail(runId!, pollingConfig);
  const { data, error, isLoading, mutate } = useFetchRunResults(runId!, pollingConfig);

  const runDetail = useEvalStore(runSelectors.getRunDetailById(runId!));
  const runResults = useEvalStore(runSelectors.getRunResultsById(runId!));

  const results: any[] = runResults?.results ?? [];
  const index = results.findIndex((r) => r.testCaseId === caseId);
  const caseResult = index >= 0 ? results[index] : undefined;
  const prevCaseId = index > 0 ? results[index - 1].testCaseId : undefined;
  const nextCaseId =
    index >= 0 && index < results.length - 1 ? results[index + 1].testCaseId : undefined;

  const threads: EvalThreadResult[] | undefined = caseResult?.evalResult?.threads;
  const hasMultipleThreads = !!threads && threads.length > 1;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Each case opens on its first trajectory.
  useEffect(() => {
    setActiveThreadId(hasMultipleThreads ? threads![0].threadId : null);
  }, [caseResult?.testCaseId]);

  const currentThread = useMemo(
    () => (activeThreadId ? threads?.find((th) => th.threadId === activeThreadId) : undefined),
    [activeThreadId, threads],
  );

  const runHref = `/eval/bench/${benchmarkId}/runs/${runId}`;
  const basePath = `${runHref}/cases`;
  const topicId = caseResult?.topicId;
  const agentId = caseResult?.topic?.agentId;

  const displayEvalResult = currentThread || caseResult?.evalResult;
  const displayPassed = currentThread ? currentThread.passed : caseResult?.passed;
  const displayScore = currentThread ? currentThread.score : caseResult?.score;
  const displayStatus = currentThread
    ? currentThread.error
      ? 'error'
      : (currentThread.status ??
        (currentThread.passed === true
          ? 'passed'
          : currentThread.passed === false
            ? 'failed'
            : undefined))
    : caseResult?.status;

  return (
    <AsyncBoundary
      data={data ?? runResults}
      error={error}
      errorVariant={'page'}
      isEmpty={!error && !caseResult}
      isLoading={isLoading}
      loading={<RunCaseSkeleton />}
      empty={
        <Flexbox padding={48}>
          <EvalEmpty
            action={<Button onClick={() => navigate(runHref)}>{t('run.case.backToRun')}</Button>}
            description={t('run.case.notFound.desc')}
            icon={FileQuestion}
            title={t('run.case.notFound.title')}
          />
        </Flexbox>
      }
      onRetry={() => mutate()}
    >
      {caseResult && (
        <Flexbox height="100%" style={{ overflow: 'hidden' }}>
          <CaseBanner
            caseNumber={(caseResult.testCase?.sortOrder ?? index) + 1}
            evalResult={displayEvalResult}
            input={caseResult.testCase?.content?.input}
            runHref={runHref}
            runName={runDetail?.name || runId!}
            status={displayStatus}
            provider={
              runDetail?.config?.subjectModel
                ? runDetail.config.subjectProvider
                : runDetail?.config?.agentSnapshot?.provider || runDetail?.targetAgent?.provider
            }
            onNext={nextCaseId ? () => navigate(`${basePath}/${nextCaseId}`) : undefined}
            onPrev={prevCaseId ? () => navigate(`${basePath}/${prevCaseId}`) : undefined}
          />
          {hasMultipleThreads && (
            <div className={styles.tabs}>
              <Tabs
                activeKey={activeThreadId!}
                items={threads!.map((thread, i) => ({
                  key: thread.threadId,
                  label: t('caseDetail.threads.attempt', { number: i + 1 }),
                }))}
                onChange={(key) => setActiveThreadId(key)}
              />
            </div>
          )}
          <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
            {topicId && agentId ? (
              <ChatArea
                agentId={agentId}
                threadId={activeThreadId ?? undefined}
                topicId={topicId}
              />
            ) : (
              <Flexbox flex={1} padding={24}>
                <EvalEmpty
                  description={t('run.case.noTranscript.desc')}
                  icon={MessagesSquare}
                  title={t('run.case.noTranscript.title')}
                />
              </Flexbox>
            )}
            <InfoSidebar
              evalResult={displayEvalResult}
              passed={displayPassed}
              // An errored case never reached the scorer — its 0 is not a verdict.
              score={getCaseVerdict(displayStatus) === 'error' ? undefined : displayScore}
              testCase={caseResult.testCase}
            />
          </Flexbox>
        </Flexbox>
      )}
    </AsyncBoundary>
  );
};

export default RunCasePage;
