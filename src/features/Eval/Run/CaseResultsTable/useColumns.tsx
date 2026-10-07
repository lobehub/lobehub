'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, type TableColumn, Tooltip } from '@lobehub/ui/base-ui';
import { Play, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getResumeTarget } from '../resumeTarget';
import { getCaseVerdict } from '../verdict';
import VerdictTag from '../VerdictTag';
import {
  CostCell,
  DurationCell,
  EmptyCell,
  InputCell,
  MonoCell,
  RunningTimer,
  ThreadDots,
} from './cells';

const RETRYABLE_STATUSES = new Set(['error', 'failed', 'timeout']);
const FINISHED_RUN_STATUSES = new Set(['completed', 'failed', 'aborted']);

interface UseColumnsParams {
  caseHref: (testCaseId: string) => string;
  k: number;
  onResumeCase?: (testCaseId: string, threadId?: string) => Promise<void>;
  onRetryCase?: (testCaseId: string) => Promise<void>;
  provider?: string | null;
  runStatus?: string;
}

const RowActions = ({
  k,
  onResumeCase,
  onRetryCase,
  record,
}: {
  k: number;
  onResumeCase?: UseColumnsParams['onResumeCase'];
  onRetryCase?: UseColumnsParams['onRetryCase'];
  record: any;
}) => {
  const { t } = useTranslation('eval');
  const [busy, setBusy] = useState<'resume' | 'retry' | null>(null);
  const showRetry = !!onRetryCase && RETRYABLE_STATUSES.has(record.status);
  const resumeTarget = onResumeCase ? getResumeTarget(record, k) : undefined;
  if (!showRetry && !resumeTarget) return null;

  const run = async (kind: 'resume' | 'retry', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Flexbox horizontal gap={4} justify="flex-end">
      {showRetry && (
        <Tooltip title={t('run.actions.retryCase')}>
          <ActionIcon
            icon={RotateCcw}
            loading={busy === 'retry'}
            size="small"
            onClick={() => run('retry', () => onRetryCase!(record.testCaseId))}
          />
        </Tooltip>
      )}
      {resumeTarget && (
        <Tooltip title={t('run.actions.resumeCase')}>
          <ActionIcon
            icon={Play}
            loading={busy === 'resume'}
            size="small"
            onClick={() =>
              run('resume', () => onResumeCase!(record.testCaseId, resumeTarget.threadId))
            }
          />
        </Tooltip>
      )}
    </Flexbox>
  );
};

export const useColumns = ({
  caseHref,
  k,
  onResumeCase,
  onRetryCase,
  provider,
  runStatus,
}: UseColumnsParams): TableColumn<any>[] => {
  const { t } = useTranslation('eval');
  const isMultiK = k > 1;
  const retry = runStatus && FINISHED_RUN_STATUSES.has(runStatus) ? onRetryCase : undefined;

  return useMemo(() => {
    const cols: TableColumn<any>[] = [
      {
        key: 'index',
        render: (_: any, record: any, index: number) => (
          <MonoCell value={String((record.testCase?.sortOrder ?? index) + 1)} />
        ),
        title: '#',
        width: 48,
      },
      {
        key: 'input',
        render: (_: any, record: any) => (
          <InputCell href={caseHref(record.testCaseId)} provider={provider} record={record} />
        ),
        title: t('table.columns.input'),
      },
      {
        key: 'verdict',
        render: (_: any, record: any) => {
          const threads = record.evalResult?.threads;
          if (isMultiK && threads?.length) return <ThreadDots threads={threads} />;
          return <VerdictTag verdict={getCaseVerdict(record.status)} />;
        },
        title: t('table.columns.status'),
        width: isMultiK ? Math.max(110, 40 + k * 12) : 120,
      },
    ];

    if (isMultiK) {
      cols.push({
        key: 'passAtK',
        render: (_: any, record: any) => {
          const passAtK = record.evalResult?.passAtK;
          if (passAtK === undefined || passAtK === null) return <EmptyCell />;
          return <VerdictTag verdict={passAtK ? 'passed' : 'failed'} />;
        },
        title: `pass@${k}`,
        width: 120,
      });
    }

    cols.push(
      {
        key: 'score',
        render: (_: any, record: any) =>
          typeof record.score === 'number' && getCaseVerdict(record.status) !== 'error' ? (
            <MonoCell value={record.score.toFixed(2)} />
          ) : (
            <EmptyCell />
          ),
        sortDirections: ['descend', 'ascend'],
        sorter: (a: any, b: any) => (a.score ?? -1) - (b.score ?? -1),
        title: t('table.columns.score'),
        width: 88,
      },
      {
        key: 'duration',
        render: (_: any, record: any) => {
          const duration = record.evalResult?.duration;
          if (duration !== undefined && duration !== null) return <DurationCell ms={duration} />;
          if (record.status === 'running' && record.createdAt)
            return <RunningTimer startTime={record.createdAt} />;
          return <EmptyCell />;
        },
        sortDirections: ['descend', 'ascend'],
        sorter: (a: any, b: any) => (a.evalResult?.duration ?? 0) - (b.evalResult?.duration ?? 0),
        title: t('table.columns.duration'),
        width: 100,
      },
      {
        key: 'steps',
        render: (_: any, record: any) => {
          const steps = record.evalResult?.steps;
          if (steps === undefined || steps === null) return <EmptyCell />;
          const llm = record.evalResult?.llmCalls;
          const tool = record.evalResult?.toolCalls;
          const sub =
            llm !== undefined || tool !== undefined
              ? `${llm ?? 0} llm · ${tool ?? 0} tool`
              : undefined;
          return <MonoCell sub={sub} value={String(steps)} />;
        },
        sortDirections: ['descend', 'ascend'],
        sorter: (a: any, b: any) => (a.evalResult?.steps ?? 0) - (b.evalResult?.steps ?? 0),
        title: t('table.columns.steps'),
        width: 110,
      },
      {
        key: 'cost',
        render: (_: any, record: any) =>
          isMultiK ? (
            <CostCell cost={record.evalResult?.totalCost} tokens={record.evalResult?.totalTokens} />
          ) : (
            <CostCell cost={record.evalResult?.cost} tokens={record.evalResult?.tokens} />
          ),
        sortDirections: ['descend', 'ascend'],
        sorter: (a: any, b: any) =>
          isMultiK
            ? (a.evalResult?.totalCost ?? 0) - (b.evalResult?.totalCost ?? 0)
            : (a.evalResult?.cost ?? 0) - (b.evalResult?.cost ?? 0),
        title: isMultiK ? t('table.columns.totalCost') : t('table.columns.cost'),
        width: 120,
      },
    );

    if (retry || onResumeCase) {
      cols.push({
        key: 'actions',
        render: (_: any, record: any) => (
          <RowActions k={k} record={record} onResumeCase={onResumeCase} onRetryCase={retry} />
        ),
        title: '',
        width: 72,
      });
    }

    return cols;
  }, [t, caseHref, isMultiK, k, retry, onResumeCase, provider]);
};
