'use client';

import type { EvalThreadResult } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { runSelectors, useEvalStore } from '@/store/eval';

import CaseHeader from './features/CaseBanner';
import ChatArea from './features/ChatArea';
import InfoSidebar from './features/InfoSidebar';

const POLLING_INTERVAL = 3000;

const CaseDetail = memo(() => {
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
  const {
    data: resultsData,
    error: resultsError,
    isLoading: resultsLoading,
    mutate: mutateResults,
  } = useFetchRunResults(runId!, pollingConfig);

  const runDetail = useEvalStore(runSelectors.getRunDetailById(runId!));
  const runResults = useEvalStore(runSelectors.getRunResultsById(runId!));
  const [caseResult, setCaseResult] = useState<any>(null);

  useEffect(() => {
    if (runResults?.results) {
      const found = runResults.results.find((r) => r.testCaseId === caseId);
      setCaseResult(found);
    }
  }, [runResults, caseId]);

  const { prevCaseId, nextCaseId } = useMemo(() => {
    if (!runResults?.results || !caseId) return {};
    const results = runResults.results;
    const currentIndex = results.findIndex((r: any) => r.testCaseId === caseId);
    if (currentIndex < 0) return {};
    return {
      nextCaseId:
        currentIndex < results.length - 1 ? results[currentIndex + 1].testCaseId : undefined,
      prevCaseId: currentIndex > 0 ? results[currentIndex - 1].testCaseId : undefined,
    };
  }, [runResults, caseId]);

  // Thread tab state
  const threads: EvalThreadResult[] | undefined = caseResult?.evalResult?.threads;
  const hasMultipleThreads = threads && threads.length > 1;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  // Reset activeThreadId when caseResult changes
  useEffect(() => {
    if (hasMultipleThreads) {
      setActiveThreadId(threads[0].threadId);
    } else {
      setActiveThreadId(null);
    }
  }, [caseResult?.testCaseId]);

  const currentThread = useMemo(
    () => (activeThreadId ? threads?.find((t) => t.threadId === activeThreadId) : undefined),
    [activeThreadId, threads],
  );

  const topicId = caseResult?.topicId;
  const agentId = caseResult?.topic?.agentId;
  const basePath = `/eval/bench/${benchmarkId}/runs/${runId}/cases`;

  // Resolve display data: thread-level if selected, otherwise topic-level
  const displayEvalResult = currentThread || caseResult?.evalResult;
  const displayPassed = currentThread ? currentThread.passed : caseResult?.passed;
  const displayScore = currentThread ? currentThread.score : caseResult?.score;

  // Skeleton → error → (resolved-null) blank, replacing a bare `return null`
  // that flashed blank while results loaded and stayed permanently blank on a
  // failed fetch (ux Read §1.1). A page-level failure gets a reason + Reload.
  return (
    <AsyncBoundary
      data={resultsData}
      error={resultsError}
      errorVariant={'page'}
      isEmpty={!caseResult}
      isLoading={resultsLoading}
      onRetry={() => mutateResults()}
    >
      {caseResult && (
        <Flexbox height="100%" style={{ overflow: 'hidden' }}>
          <CaseHeader
            caseNumber={(caseResult.testCase?.sortOrder ?? 0) + 1}
            evalResult={displayEvalResult}
            passed={displayPassed}
            runName={runDetail?.name || runId!.slice(0, 8)}
            score={displayScore}
            onBack={() => navigate(`/eval/bench/${benchmarkId}/runs/${runId}`)}
            onNext={nextCaseId ? () => navigate(`${basePath}/${nextCaseId}`) : undefined}
            onPrev={prevCaseId ? () => navigate(`${basePath}/${prevCaseId}`) : undefined}
          />
          {hasMultipleThreads && (
            <Flexbox
              paddingInline={16}
              style={{ borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`, flex: 'none' }}
            >
              <Tabs
                activeKey={activeThreadId!}
                items={threads.map((thread, index) => ({
                  key: thread.threadId,
                  label: t('caseDetail.threads.attempt', { number: index + 1 }),
                }))}
                onChange={(key) => setActiveThreadId(key)}
              />
            </Flexbox>
          )}
          <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
            {topicId && agentId ? (
              <ChatArea
                agentId={agentId}
                threadId={activeThreadId ?? undefined}
                topicId={topicId}
              />
            ) : (
              <Flexbox flex={1} />
            )}
            <InfoSidebar
              evalResult={displayEvalResult}
              passed={displayPassed}
              score={displayScore}
              testCase={caseResult.testCase}
            />
          </Flexbox>
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

export default CaseDetail;
