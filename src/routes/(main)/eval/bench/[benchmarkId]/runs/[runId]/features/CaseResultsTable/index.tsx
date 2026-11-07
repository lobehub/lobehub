'use client';

import type { EvalThreadResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import {
  ActionIcon,
  Badge,
  createStaticStyles,
  cssVar,
  Flexbox,
  Icon,
  Input,
  Select,
  Table,
  type TableColumn,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { Play, RotateCcw, SearchIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getCaseLabel } from '@/features/Eval/caseLabel';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import SegmentBar from '@/routes/(main)/eval/features/SegmentBar';

import { getResumeTarget } from '../resumeTarget';
import { type ThreadVerdict, threadVerdict } from './threadVerdict';

const styles = createStaticStyles(({ css }) => ({
  caseLink: css`
    display: block;
    min-width: 0;
    color: inherit;
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  durationSub: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s ease,
      background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  chipActive: css`
    border-color: ${cssVar.colorText};
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  chipCount: css`
    font-family: ${cssVar.fontFamilyCode};
    font-weight: 600;
  `,
  chipDot: css`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
  filterBar: css`
    padding-block: 12px;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  summaryBar: css`
    padding-block: 16px;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  summaryLabel: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  indexCell: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  monoCell: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
  threadDot: css`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
  `,
}));

interface CaseResultsTableProps {
  benchmarkId: string;
  k?: number;
  onResumeCase?: (testCaseId: string, threadId?: string) => Promise<void>;
  onRetryCase?: (testCaseId: string) => Promise<void>;
  results: any[];
  runId: string;
  runStatus?: string;
}

const badgeTextStyle = createStaticStyles(({ css, cssVar }) => ({
  text: css`
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

const BadgeText = memo<{ children: string }>(({ children }) => (
  <span className={badgeTextStyle.text}>{children}</span>
));

const StatusBadge = memo<{ record: any }>(({ record }) => {
  const { t } = useTranslation('eval');
  const status: string | null | undefined = record.status;

  // return <div>{status}</div>;

  if (!status || status === 'pending')
    return <Badge status="default" text={<BadgeText>{t('run.status.pending')}</BadgeText>} />;

  if (status === 'running')
    return <Badge status="processing" text={<BadgeText>{t('run.status.running')}</BadgeText>} />;

  // One shape for every status — a dot in the summary chips' colour and a label —
  // so a column of mixed outcomes reads as one column.
  if (status === 'passed')
    return (
      <Badge color={cssVar.colorSuccess} text={<BadgeText>{t('table.filter.passed')}</BadgeText>} />
    );

  if (status === 'failed')
    return (
      <Badge color={cssVar.colorError} text={<BadgeText>{t('table.filter.failed')}</BadgeText>} />
    );

  if (status === 'error') {
    const errorMsg = record.evalResult?.error;
    const badge = (
      <Badge color={cssVar.colorWarning} text={<BadgeText>{t('table.filter.error')}</BadgeText>} />
    );
    return errorMsg ? <Tooltip title={errorMsg}>{badge}</Tooltip> : badge;
  }

  if (status === 'timeout')
    return (
      <Badge color={cssVar.colorWarning} text={<BadgeText>{t('run.status.timeout')}</BadgeText>} />
    );

  if (status === 'external') {
    const badge = <Badge color="purple" text={<BadgeText>{t('run.status.external')}</BadgeText>} />;
    return <Tooltip title={t('run.status.external.tooltip')}>{badge}</Tooltip>;
  }

  if (status === 'completed') {
    // 'completed' means run finished + evaluation finished, does not mean the result necessarily passed
    const badge = <Badge color="blue" text={<BadgeText>{t('run.status.completed')}</BadgeText>} />;
    return <Tooltip title={t('run.status.completed.tooltip')}>{badge}</Tooltip>;
  }

  return <Badge status="default" text={<BadgeText>{status}</BadgeText>} />;
});

/** One dot per attempt, in the summary chips' colours: passed, failed, error, pending. */
const THREAD_COLORS: Record<ThreadVerdict, string> = {
  completed: cssVar.colorInfo,
  error: cssVar.colorWarning,
  external: cssVar.colorWarning,
  failed: cssVar.colorError,
  passed: cssVar.colorSuccess,
  pending: cssVar.colorTextQuaternary,
  running: cssVar.colorPrimary,
  timeout: cssVar.colorWarning,
};

const THREAD_LABEL_KEYS = {
  completed: 'run.status.completed',
  error: 'table.filter.error',
  external: 'run.status.external',
  failed: 'table.filter.failed',
  passed: 'table.filter.passed',
  pending: 'run.status.pending',
  running: 'run.status.running',
  timeout: 'run.status.timeout',
} as const satisfies Record<ThreadVerdict, string>;

const ThreadDots = memo<{ threads: EvalThreadResult[] }>(({ threads }) => {
  const { t } = useTranslation('eval');
  return (
    <Flexbox horizontal align="center" gap={4}>
      {threads.map((thread) => {
        const verdict = threadVerdict(thread);
        return (
          <Tooltip key={thread.threadId} title={t(THREAD_LABEL_KEYS[verdict])}>
            <span
              className={styles.threadDot}
              style={{ backgroundColor: THREAD_COLORS[verdict] }}
            />
          </Tooltip>
        );
      })}
    </Flexbox>
  );
});

const DurationCell = memo<{ ms: number }>(({ ms }) => {
  const sec = ms / 1000;
  if (sec < 60) {
    return <span className={styles.monoCell}>{sec.toFixed(1)}s</span>;
  }
  const min = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  return (
    <span className={styles.monoCell} title={`${sec.toFixed(1)}s`}>
      {min}m {remSec}s
    </span>
  );
});

const RunningTimer = memo<{ startTime: string }>(({ startTime }) => {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startTime).getTime());

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - new Date(startTime).getTime());
    }, 100);
    return () => clearInterval(timer);
  }, [startTime]);

  return <DurationCell ms={elapsed} />;
});

const RETRYABLE_STATUSES = new Set(['error', 'failed', 'timeout']);
const FINISHED_RUN_STATUSES = new Set(['completed', 'failed', 'aborted']);
const CaseResultsTable = memo<CaseResultsTableProps>(
  ({ results, benchmarkId, runId, k = 1, onRetryCase, onResumeCase, runStatus }) => {
    const { t } = useTranslation('eval');
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [pageSize, setPageSize] = useState(20);
    const [retryingCaseId, setRetryingCaseId] = useState<string | null>(null);
    const [resumingCaseId, setResumingCaseId] = useState<string | null>(null);

    const isMultiK = k > 1;
    const canRetryCase = !!onRetryCase && !!runStatus && FINISHED_RUN_STATUSES.has(runStatus);
    const canResumeCase = !!onResumeCase;

    const filteredResults = useMemo(() => {
      let filtered = results;
      if (searchText) {
        const query = searchText.toLowerCase();
        filtered = filtered.filter(
          (r: any) =>
            getCaseLabel(r.testCase).toLowerCase().includes(query) ||
            r.testCase?.content?.input?.toLowerCase().includes(query),
        );
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending') {
          filtered = filtered.filter((r: any) => !r.status || r.status === 'pending');
        } else if (statusFilter === 'running') {
          filtered = filtered.filter((r: any) => r.status === 'running');
        } else {
          filtered = filtered.filter((r: any) => r.status === statusFilter);
        }
      }
      return filtered;
    }, [results, searchText, statusFilter]);

    // Status distribution across all results — drives the summary SegmentBar + filter chips.
    const distribution = useMemo(() => {
      let passed = 0;
      let failed = 0;
      let error = 0;
      let pending = 0;
      for (const r of results) {
        const status: string | undefined = r.status;
        if (status === 'passed') passed++;
        else if (status === 'failed') failed++;
        else if (status === 'error' || status === 'timeout') error++;
        else if (!status || status === 'pending' || status === 'running') pending++;
      }
      return { error, failed, passed, pending };
    }, [results]);

    const statusChips = [
      {
        color: cssVar.colorSuccess,
        count: distribution.passed,
        label: t('table.filter.passed'),
        value: 'passed',
      },
      {
        color: cssVar.colorError,
        count: distribution.failed,
        label: t('table.filter.failed'),
        value: 'failed',
      },
      {
        color: cssVar.colorWarning,
        count: distribution.error,
        label: t('table.filter.error'),
        value: 'error',
      },
      {
        color: cssVar.colorTextQuaternary,
        count: distribution.pending,
        label: t('run.status.pending'),
        value: 'pending',
      },
    ];

    const segments = [
      { color: cssVar.colorSuccess, value: distribution.passed },
      { color: cssVar.colorError, value: distribution.failed },
      { color: cssVar.colorWarning, value: distribution.error },
      { color: cssVar.colorTextQuaternary, value: distribution.pending },
    ];

    const columns: TableColumn<any>[] = useMemo(() => {
      const cols: TableColumn<any>[] = [
        {
          key: 'index',
          render: (_: any, record: any, index: number) => (
            <span className={styles.indexCell}>{record.testCase?.sortOrder ?? index + 1}</span>
          ),
          title: '#',
          width: 48,
        },
        {
          // The case's declared title, else its input on one line; the full
          // prompt or JSON payload lives on the case page.
          ellipsis: true,
          key: 'case',
          render: (_: any, record: any) => {
            const label = getCaseLabel(record.testCase);
            return (
              <WorkspaceLink
                className={styles.caseLink}
                to={`/eval/bench/${benchmarkId}/runs/${runId}/cases/${record.testCaseId}`}
              >
                <Text ellipsis={{ tooltip: label, tooltipWhenOverflow: true }}>{label}</Text>
              </WorkspaceLink>
            );
          },
          title: t('table.columns.case'),
        },
      ];

      if (isMultiK) {
        cols.push(
          {
            key: 'threads',
            render: (_: any, record: any) => {
              const threads: any[] = record.evalResult?.threads;
              if (!threads?.length) return <StatusBadge record={record} />;
              return <ThreadDots threads={threads} />;
            },
            title: t('table.columns.status'),
            width: 60 + k * 12,
          },
          {
            key: 'passAtK',
            render: (_: any, record: any) => {
              const passAtK = record.evalResult?.passAtK;
              const passAllK = record.evalResult?.passAllK;
              const hasAtK = passAtK !== undefined && passAtK !== null;
              const hasAllK = passAllK !== undefined && passAllK !== null;
              if (!hasAtK && !hasAllK) return '-';
              return (
                <Flexbox gap={2}>
                  {hasAtK && <StatusBadge record={{ status: passAtK ? 'passed' : 'failed' }} />}
                  {hasAllK && (
                    <span className={styles.durationSub}>
                      ^{k}: {passAllK ? t('table.filter.passed') : t('table.filter.failed')}
                    </span>
                  )}
                </Flexbox>
              );
            },
            title: `pass@${k}`,
            width: 110,
          },
        );
      } else {
        cols.push({
          key: 'status',
          render: (_: any, record: any) => <StatusBadge record={record} />,
          title: t('table.columns.status'),
          width: 120,
        });
      }

      // Steps and cost say what a case took; duration follows them.
      cols.push(
        {
          key: 'steps',
          render: (_: any, record: any) => {
            const rawSteps = record.evalResult?.steps;
            if (rawSteps === undefined || rawSteps === null) return '-';
            const rawLlm = record.evalResult?.llmCalls;
            const rawTool = record.evalResult?.toolCalls;
            const steps = rawSteps;
            const llmCalls = rawLlm != null ? rawLlm : undefined;
            const toolCalls = rawTool != null ? rawTool : undefined;
            const hasDetail = llmCalls !== undefined || toolCalls !== undefined;
            return (
              <Flexbox gap={2}>
                <span className={styles.monoCell}>{steps}</span>
                {hasDetail && (
                  <span className={styles.durationSub}>
                    {llmCalls ?? 0} llm · {toolCalls ?? 0} tool
                  </span>
                )}
              </Flexbox>
            );
          },
          sortDirections: ['descend', 'ascend'],
          sorter: (a: any, b: any) => (a.evalResult?.steps ?? 0) - (b.evalResult?.steps ?? 0),
          title: t('table.columns.steps'),
          width: 130,
        },
        {
          key: 'cost',
          render: (_: any, record: any) => {
            const cost = record.evalResult?.cost;
            const tokens = record.evalResult?.tokens;
            const hasCost = cost !== undefined && cost !== null;
            const hasTokens = tokens !== undefined && tokens !== null;
            if (!hasCost && !hasTokens) return '-';
            return (
              <Flexbox gap={2}>
                {hasCost && <span className={styles.monoCell}>${formatCost(cost)}</span>}
                {hasTokens && (
                  <span className={styles.durationSub}>{formatShortenNumber(tokens)} tokens</span>
                )}
              </Flexbox>
            );
          },
          sortDirections: ['descend', 'ascend'],
          sorter: (a: any, b: any) => (a.evalResult?.cost ?? 0) - (b.evalResult?.cost ?? 0),
          title: t('table.columns.cost'),
          width: 120,
        },
        {
          key: 'duration',
          render: (_: any, record: any) => {
            const duration = record.evalResult?.duration;
            if (duration !== undefined && duration !== null) {
              return <DurationCell ms={duration} />;
            }
            if (record.status === 'running' && record.createdAt) {
              return <RunningTimer startTime={record.createdAt} />;
            }
            return '-';
          },
          sortDirections: ['descend', 'ascend'],
          sorter: (a: any, b: any) => (a.evalResult?.duration ?? 0) - (b.evalResult?.duration ?? 0),
          title: t('table.columns.duration'),
          width: 120,
        },
      );

      // Total cost column at the end when K > 1
      if (isMultiK) {
        cols.push({
          key: 'totalCost',
          render: (_: any, record: any) => {
            const cost = record.evalResult?.totalCost;
            const tokens = record.evalResult?.totalTokens;
            const hasCost = cost !== undefined && cost !== null;
            const hasTokens = tokens !== undefined && tokens !== null;
            if (!hasCost && !hasTokens) return '-';
            return (
              <Flexbox gap={2}>
                {hasCost && <span className={styles.monoCell}>${formatCost(cost)}</span>}
                {hasTokens && (
                  <span className={styles.durationSub}>{formatShortenNumber(tokens)} tokens</span>
                )}
              </Flexbox>
            );
          },
          sortDirections: ['descend', 'ascend'],
          sorter: (a: any, b: any) =>
            (a.evalResult?.totalCost ?? 0) - (b.evalResult?.totalCost ?? 0),
          title: t('table.columns.totalCost'),
          width: 120,
        });
      }

      if (canRetryCase || canResumeCase) {
        cols.push({
          key: 'actions',
          render: (_: any, record: any) => {
            const showRetry = canRetryCase && RETRYABLE_STATUSES.has(record.status);
            const resumeTarget = getResumeTarget(record, k);
            const showResume = canResumeCase && !!resumeTarget;
            if (!showRetry && !showResume) return null;
            const isRetrying = retryingCaseId === record.testCaseId;
            const isResuming = resumingCaseId === record.testCaseId;
            return (
              <Flexbox horizontal gap={4}>
                {showRetry && (
                  <Tooltip title={t('run.actions.retryCase')}>
                    <ActionIcon
                      icon={RotateCcw}
                      loading={isRetrying}
                      size="small"
                      onClick={async () => {
                        setRetryingCaseId(record.testCaseId);
                        try {
                          await onRetryCase!(record.testCaseId);
                        } finally {
                          setRetryingCaseId(null);
                        }
                      }}
                    />
                  </Tooltip>
                )}
                {showResume && (
                  <Tooltip title={t('run.actions.resumeCase')}>
                    <ActionIcon
                      icon={Play}
                      loading={isResuming}
                      size="small"
                      onClick={async () => {
                        setResumingCaseId(record.testCaseId);
                        try {
                          await onResumeCase!(record.testCaseId, resumeTarget?.threadId);
                        } finally {
                          setResumingCaseId(null);
                        }
                      }}
                    />
                  </Tooltip>
                )}
              </Flexbox>
            );
          },
          title: '',
          width: 80,
        });
      }

      return cols;
    }, [
      benchmarkId,
      runId,
      t,
      isMultiK,
      k,
      canRetryCase,
      canResumeCase,
      retryingCaseId,
      resumingCaseId,
      onRetryCase,
      onResumeCase,
    ]);

    return (
      <Flexbox gap={0}>
        {/* Status distribution summary — outcome at a glance + quick filter chips */}
        <Flexbox className={styles.summaryBar} gap={12}>
          <span className={styles.summaryLabel}>{t('table.columns.status')}</span>
          <SegmentBar segments={segments} />
          <Flexbox horizontal gap={8} wrap="wrap">
            {statusChips.map((chip) => {
              const isActive = statusFilter === chip.value;
              return (
                <span
                  className={`${styles.chip}${isActive ? ` ${styles.chipActive}` : ''}`}
                  key={chip.value}
                  role={'button'}
                  tabIndex={0}
                  onClick={() => setStatusFilter(isActive ? 'all' : chip.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setStatusFilter(isActive ? 'all' : chip.value);
                    }
                  }}
                >
                  <span className={styles.chipDot} style={{ backgroundColor: chip.color }} />
                  {chip.label}
                  <span className={styles.chipCount}>{chip.count}</span>
                </span>
              );
            })}
          </Flexbox>
        </Flexbox>

        {/* Filters */}
        <Flexbox horizontal align="center" className={styles.filterBar} gap={8}>
          <Input
            allowClear
            placeholder={t('table.search.placeholder')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            style={{ width: 240 }}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select
            style={{ width: 120 }}
            value={statusFilter}
            options={[
              { label: t('table.filter.all'), value: 'all' },
              { label: t('table.filter.passed'), value: 'passed' },
              { label: t('table.filter.failed'), value: 'failed' },
              { label: t('table.filter.error'), value: 'error' },
              { label: t('table.filter.running'), value: 'running' },
              { label: t('run.status.pending'), value: 'pending' },
              { label: t('run.status.external'), value: 'external' },
              { label: t('run.status.completed'), value: 'completed' },
            ]}
            onChange={setStatusFilter}
          />
          <span style={{ color: cssVar.colorTextTertiary, fontSize: 12, whiteSpace: 'nowrap' }}>
            {t('table.total', { count: filteredResults.length })}
          </span>
        </Flexbox>
        <Table
          columns={columns}
          dataSource={filteredResults}
          rowKey="testCaseId"
          size="small"
          pagination={{
            pageSize,
            showSizeChanger: true,
            onShowSizeChange: (_, size) => setPageSize(size),
          }}
        />
      </Flexbox>
    );
  },
);

export default CaseResultsTable;
