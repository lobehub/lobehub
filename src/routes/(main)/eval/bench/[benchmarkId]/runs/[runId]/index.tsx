'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { Button, Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Play, RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { runSelectors, useEvalStore } from '@/store/eval';

import { createBatchResumeModal } from './features/BatchResumeModal';
import CaseResultsTable from './features/CaseResultsTable';
import BenchmarkCharts from './features/Charts/BenchmarkCharts';
import IdleState from './features/IdleState';
import PendingState from './features/PendingState';
import { getResumeTarget } from './features/resumeTarget';
import RunHeader from './features/RunHeader';
import RunningState from './features/RunningState';
import StatsCards from './features/StatsCards';

const POLLING_INTERVAL = 3000;

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  panelBody: css`
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
  `,
  panelHeader: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    padding-block: 12px;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  panelLabel: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  stateBody: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 430px;
    padding: 20px;
  `,
}));

const RunDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { benchmarkId, runId } = useParams<{ benchmarkId: string; runId: string }>();
  const useFetchRunDetail = useEvalStore((s) => s.useFetchRunDetail);
  const useFetchRunResults = useEvalStore((s) => s.useFetchRunResults);
  const retryRunErrors = useEvalStore((s) => s.retryRunErrors);
  const retryRunCase = useEvalStore((s) => s.retryRunCase);
  const resumeRunCase = useEvalStore((s) => s.resumeRunCase);
  const batchResumeRunCases = useEvalStore((s) => s.batchResumeRunCases);
  const runDetail = useEvalStore(runSelectors.getRunDetailById(runId!));
  const runResults = useEvalStore(runSelectors.getRunResultsById(runId!));
  const isActive = useEvalStore(runSelectors.isRunActive(runId!));
  const [retrying, setRetrying] = useState(false);

  const pollingConfig = { refreshInterval: isActive ? POLLING_INTERVAL : 0 };

  useFetchRunDetail(runId!, pollingConfig);
  useFetchRunResults(runId!, pollingConfig);

  if (!runDetail) return null;

  const hasResults = !!runResults?.results?.length;
  const isFinished =
    runDetail.status === 'completed' ||
    runDetail.status === 'failed' ||
    runDetail.status === 'aborted';

  const metrics = runDetail.metrics;
  const completedCases = metrics?.completedCases ?? 0;
  const totalCases = metrics?.totalCases ?? 0;
  const progress = totalCases > 0 ? Math.round((completedCases / totalCases) * 100) : 0;
  const showProgress = totalCases > 0 && progress < 100;
  const errorCount = (metrics?.errorCases ?? 0) + (metrics?.timeoutCases ?? 0);
  const canRetry = isFinished && errorCount > 0;

  const k = runDetail.config?.k ?? 1;
  const canBatchResume = (runResults?.results ?? []).some(
    (result: any) => !!getResumeTarget(result, k),
  );

  return (
    <Flexbox gap={24} padding={24} style={{ margin: '0 auto', maxWidth: 1440, width: '100%' }}>
      <RunHeader
        benchmarkId={benchmarkId!}
        hideStart={runDetail.status === 'idle'}
        run={runDetail}
      />

      {/* Report panel (when finished) or state panel (when not finished) */}
      {isFinished ? (
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <span className={styles.panelLabel}>{t('run.detail.report')}</span>
          </header>
          <div className={styles.panelBody}>
            <StatsCards metrics={runDetail.metrics ?? undefined} />
            {hasResults && (
              <BenchmarkCharts
                benchmarkId={benchmarkId!}
                results={runResults.results}
                runId={runId!}
              />
            )}
          </div>
        </section>
      ) : (
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <span className={styles.panelLabel}>{t('run.detail.report')}</span>
          </header>
          <div className={styles.stateBody}>
            {runDetail.status === 'running' ? (
              <RunningState />
            ) : runDetail.status === 'pending' ? (
              <PendingState hint={t('run.pending.hint')} />
            ) : runDetail.status === 'external' ? (
              <PendingState hint={t('run.external.hint')} />
            ) : (
              <IdleState run={runDetail} />
            )}
          </div>
        </section>
      )}

      {/* Case Results (always shown when results exist) */}
      {hasResults && (
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <span className={styles.panelLabel}>{t('run.detail.caseResults')}</span>
            {(showProgress || canRetry || canBatchResume) && (
              <Flexbox horizontal align="center" gap={8}>
                {showProgress && (
                  <>
                    <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
                      {completedCases}/{totalCases} {t('run.detail.progressCases')}
                    </Text>
                    <Progress
                      percent={progress}
                      showInfo={false}
                      size="small"
                      status={isActive ? 'active' : undefined}
                      style={{ margin: 0, width: 120 }}
                    />
                    <Text fontSize={12} type={'secondary'}>
                      {progress}%
                    </Text>
                  </>
                )}
                {canBatchResume && (
                  <Button
                    icon={<Play size={14} />}
                    size="small"
                    onClick={() =>
                      createBatchResumeModal({
                        onConfirm: (targets) => batchResumeRunCases(runId!, targets),
                        runId: runId!,
                      })
                    }
                  >
                    {t('run.actions.batchResume')}
                  </Button>
                )}
                {canRetry && (
                  <Button
                    icon={<RotateCcw size={14} />}
                    loading={retrying}
                    size="small"
                    onClick={() => {
                      confirmModal({
                        content: t('run.actions.retryErrors.confirm'),
                        onOk: async () => {
                          setRetrying(true);
                          try {
                            await retryRunErrors(runId!);
                          } finally {
                            setRetrying(false);
                          }
                        },
                        title: t('run.actions.retryErrors'),
                      });
                    }}
                  >
                    {t('run.actions.retryErrors')}
                  </Button>
                )}
              </Flexbox>
            )}
          </header>
          <CaseResultsTable
            benchmarkId={benchmarkId!}
            k={k}
            results={runResults.results}
            runId={runId!}
            runStatus={runDetail.status}
            onResumeCase={(testCaseId, threadId) => resumeRunCase(runId!, testCaseId, threadId)}
            onRetryCase={(testCaseId) => retryRunCase(runId!, testCaseId)}
          />
        </section>
      )}
    </Flexbox>
  );
});

export default RunDetail;
