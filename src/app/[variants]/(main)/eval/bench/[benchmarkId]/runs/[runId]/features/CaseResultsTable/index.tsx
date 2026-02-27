'use client';

import type { EvalThreadResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { ActionIcon, Flexbox, Icon, Tag } from '@lobehub/ui';
import { Badge, Input, Select, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles, cssVar } from 'antd-style';
import { Footprints, RotateCcw } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

const styles = createStaticStyles(({ css, cssVar }) => ({
  caseLink: css`
    color: inherit;
    text-decoration: none;
  `,
  durationSub: css`
    font-family: monospace;
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
  filterBar: css`
    padding-block: 12px;
    padding-inline: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  indexCell: css`
    font-family: monospace;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  monoCell: css`
    font-family: monospace;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  threadDot: css`
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
}));

interface CaseResultsTableProps {
  benchmarkId: string;
  k?: number;
  onRetryCase?: (testCaseId: string) => Promise<void>;
  results: any[];
  runId: string;
  runStatus?: string;
}

const badgeTextStyle = createStaticStyles(({ css, cssVar }) => ({
  text: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const BadgeText = memo<{ children: string }>(({ children }) => (
  <span className={badgeTextStyle.text}>{children}</span>
));

const StatusBadge = memo<{ record: any }>(({ record }) => {
  const { t } = useTranslation('eval');
  const status: string | null | undefined = record.status;

  if (!status || status === 'pending')
    return <Badge status="default" text={<BadgeText>{t('run.status.pending')}</BadgeText>} />;

  if (status === 'running')
    return <Badge status="processing" text={<BadgeText>{t('run.status.running')}</BadgeText>} />;

  if (status === 'passed') return <Tag color="green">{t('table.filter.passed')}</Tag>;

  if (status === 'failed') return <Tag color="red">{t('table.filter.failed')}</Tag>;

  if (status === 'error') {
    const errorMsg = record.evalResult?.error;
    const badge = <Badge color="orange" text={<BadgeText>{t('table.filter.error')}</BadgeText>} />;
    return errorMsg ? <Tooltip title={errorMsg}>{badge}</Tooltip> : badge;
  }

  if (status === 'timeout')
    return <Badge color="orange" text={<BadgeText>{t('run.status.timeout')}</BadgeText>} />;

  return <Badge status="default" text={<BadgeText>{status}</BadgeText>} />;
});

/**
 * K dots for thread pass/fail: green=passed, red=failed, orange=error, gray=pending
 */
const ThreadDots = memo<{ threads: EvalThreadResult[] }>(({ threads }) => (
  <Flexbox horizontal align="center" gap={4}>
    {threads.map((thread) => {
      let color: string = cssVar.colorTextTertiary;

      if (thread.passed === true) {
        color = cssVar.colorSuccess;
      }

      const label = thread.error
        ? 'error'
        : thread.passed === true
          ? 'passed'
          : thread.passed === false
            ? 'failed'
            : 'pending';

      return (
        <Tooltip key={thread.threadId} title={label}>
          <span className={styles.threadDot} style={{ backgroundColor: color }} />
        </Tooltip>
      );
    })}
  </Flexbox>
));

const DurationCell = memo<{ ms: number }>(({ ms }) => {
  const sec = ms / 1000;
  if (sec < 60) {
    return <span className={styles.monoCell}>{sec.toFixed(1)}s</span>;
  }
  const min = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  return (
    <Flexbox gap={2}>
      <span className={styles.monoCell}>
        {min}m {remSec}s
      </span>
      <span className={styles.durationSub}>{sec.toFixed(1)}s</span>
    </Flexbox>
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
  ({ results, benchmarkId, runId, k = 1, onRetryCase, runStatus }) => {
    const { t } = useTranslation('eval');
    const [searchText, setSearchText] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [pageSize, setPageSize] = useState(20);
    const [retryingCaseId, setRetryingCaseId] = useState<string | null>(null);

    const isMultiK = k > 1;
    const canRetryCase = onRetryCase && runStatus && FINISHED_RUN_STATUSES.has(runStatus);

    const filteredResults = useMemo(() => {
      let filtered = results;
      if (searchText) {
        filtered = filtered.filter((r: any) =>
          r.testCase?.content?.input?.toLowerCase().includes(searchText.toLowerCase()),
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

    const columns: ColumnsType<any> = useMemo(() => {
      const cols: ColumnsType<any> = [
        {
          key: 'index',
          render: (_: any, record: any, index: number) => (
            <span className={styles.indexCell}>{record.testCase?.sortOrder ?? index + 1}</span>
          ),
          title: '#',
          width: 48,
        },
        {
          dataIndex: ['testCase', 'content', 'input'],
          key: 'input',
          render: (text: string, record: any) => (
            <Link
              className={styles.caseLink}
              to={`/eval/bench/${benchmarkId}/runs/${runId}/cases/${record.testCaseId}`}
            >
              {text}
            </Link>
          ),
          title: t('table.columns.input'),
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
                  {hasAtK &&
                    (passAtK ? (
                      <Tag color="green">{t('table.filter.passed')}</Tag>
                    ) : (
                      <Tag color="red">{t('table.filter.failed')}</Tag>
                    ))}
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
          width: 100,
        });
      }

      cols.push(
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
          sortDirections: ['descend', 'ascend'] as const,
          sorter: (a: any, b: any) => (a.evalResult?.duration ?? 0) - (b.evalResult?.duration ?? 0),
          title: t('table.columns.duration'),
          width: 100,
        },
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
                <Flexbox horizontal align="center" gap={4}>
                  <Icon icon={Footprints} size={12} style={{ opacity: 0.5 }} />
                  <span className={styles.monoCell}>{steps}</span>
                </Flexbox>
                {hasDetail && (
                  <span className={styles.durationSub}>
                    {llmCalls ?? 0} llm / {toolCalls ?? 0} tool
                  </span>
                )}
              </Flexbox>
            );
          },
          sortDirections: ['descend', 'ascend'] as const,
          sorter: (a: any, b: any) => (a.evalResult?.steps ?? 0) - (b.evalResult?.steps ?? 0),
          title: t('table.columns.steps'),
          width: 120,
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
          sortDirections: ['descend', 'ascend'] as const,
          sorter: (a: any, b: any) => (a.evalResult?.cost ?? 0) - (b.evalResult?.cost ?? 0),
          title: t('table.columns.cost'),
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
          sortDirections: ['descend', 'ascend'] as const,
          sorter: (a: any, b: any) =>
            (a.evalResult?.totalCost ?? 0) - (b.evalResult?.totalCost ?? 0),
          title: t('table.columns.totalCost'),
          width: 120,
        });
      }

      if (canRetryCase) {
        cols.push({
          key: 'actions',
          render: (_: any, record: any) => {
            if (!RETRYABLE_STATUSES.has(record.status)) return null;
            const isRetrying = retryingCaseId === record.testCaseId;
            return (
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
            );
          },
          title: '',
          width: 48,
        });
      }

      return cols;
    }, [benchmarkId, runId, t, isMultiK, k, canRetryCase, retryingCaseId, onRetryCase]);

    return (
      <Flexbox gap={0}>
        {/* Filters */}
        <Flexbox horizontal align="center" className={styles.filterBar} gap={8}>
          <Input.Search
            allowClear
            placeholder={t('table.search.placeholder')}
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
            size: 'small',
            onShowSizeChange: (_, size) => setPageSize(size),
          }}
        />
      </Flexbox>
    );
  },
);

export default CaseResultsTable;
