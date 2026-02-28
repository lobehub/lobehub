'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Button, Card, Progress, Typography } from 'antd';
import { RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

import { runSelectors, useEvalStore } from '@/store/eval';

import CaseResultsTable from './features/CaseResultsTable';
import BenchmarkCharts from './features/Charts/BenchmarkCharts';
import IdleState from './features/IdleState';
import PendingState from './features/PendingState';
import RunHeader from './features/RunHeader';
import RunningState from './features/RunningState';
import StatsCards from './features/StatsCards';

const POLLING_INTERVAL = 3000;

const RunDetail = memo(() => {
  const { t } = useTranslation('eval');
  const { modal } = App.useApp();
  const { benchmarkId, runId } = useParams<{ benchmarkId: string; runId: string }>();
  const useFetchRunDetail = useEvalStore((s) => s.useFetchRunDetail);
  const useFetchRunResults = useEvalStore((s) => s.useFetchRunResults);
  const retryRunErrors = useEvalStore((s) => s.retryRunErrors);
  const retryRunCase = useEvalStore((s) => s.retryRunCase);
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

  return (
    <Flexbox gap={24} padding={24} style={{ margin: '0 auto', maxWidth: 1440, width: '100%' }}>
      <RunHeader
        benchmarkId={benchmarkId!}
        hideStart={runDetail.status === 'idle'}
        run={runDetail}
      />

      {/* Report Card (when finished) or State Animation Card (when not finished) */}
      {isFinished ? (
        <Card
          styles={{
            body: { display: 'flex', flexDirection: 'column', gap: 20, padding: 20 },
            header: { minHeight: 'auto', padding: '12px 20px' },
          }}
          title={
            <Typography.Text strong style={{ fontSize: 14 }}>
              {t('run.detail.report')}
            </Typography.Text>
          }
        >
          <StatsCards metrics={runDetail.metrics ?? undefined} />
          {hasResults && (
            <BenchmarkCharts
              benchmarkId={benchmarkId!}
              results={runResults.results}
              runId={runId!}
            />
          )}
        </Card>
      ) : (
        <Card
          styles={{
            body: {
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'center',
              minHeight: 430,
              padding: 20,
            },
            header: { minHeight: 'auto', padding: '12px 20px' },
          }}
          title={
            <Typography.Text strong style={{ fontSize: 14 }}>
              {t('run.detail.report')}
            </Typography.Text>
          }
        >
          {runDetail.status === 'running' ? (
            <RunningState />
          ) : runDetail.status === 'pending' ? (
            <PendingState />
          ) : (
            <IdleState run={runDetail} />
          )}
        </Card>
      )}

      {/* Case Results (always shown when results exist) */}
      {hasResults && (
        <Card
          styles={{ body: { padding: 0 }, header: { padding: '12px 20px' } }}
          extra={
            showProgress ? (
              <Flexbox horizontal align="center" gap={8}>
                <Typography.Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type="secondary">
                  {completedCases}/{totalCases} {t('run.detail.progressCases')}
                </Typography.Text>
                <Progress
                  percent={progress}
                  showInfo={false}
                  size="small"
                  status={isActive ? 'active' : undefined}
                  style={{ margin: 0, width: 120 }}
                />
                <Typography.Text style={{ fontSize: 12 }} type="secondary">
                  {progress}%
                </Typography.Text>
              </Flexbox>
            ) : canRetry ? (
              <Button
                icon={<RotateCcw size={14} />}
                loading={retrying}
                size="small"
                onClick={() => {
                  modal.confirm({
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
            ) : undefined
          }
          title={
            <Typography.Text strong style={{ fontSize: 14 }}>
              {t('run.detail.caseResults')}
            </Typography.Text>
          }
        >
          <CaseResultsTable
            benchmarkId={benchmarkId!}
            k={runDetail.config?.k ?? 1}
            results={runResults.results}
            runId={runId!}
            runStatus={runDetail.status}
            onRetryCase={(testCaseId) => retryRunCase(runId!, testCaseId)}
          />
        </Card>
      )}
    </Flexbox>
  );
});

export default RunDetail;
