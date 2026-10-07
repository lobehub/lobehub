'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Input, Segmented, Table } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ListFilter, SearchIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import EvalEmpty from '@/features/Eval/components/EvalEmpty';
import SegmentBar from '@/features/Eval/SegmentBar';

import { type CaseVerdict, countVerdicts, getCaseVerdict, VERDICT_FILTERS } from '../verdict';
import { VERDICT_META } from '../VerdictTag';
import { useColumns } from './useColumns';

const styles = createStaticStyles(({ css }) => ({
  count: css`
    margin-inline-start: 6px;
    font-family: ${cssVar.fontFamilyCode};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  dot: css`
    display: inline-block;
    flex: none;

    width: 8px;
    height: 8px;
    margin-inline-end: 6px;
    border-radius: 999px;
  `,
  panel: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  toolbar: css`
    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const BAR_COLOR: Partial<Record<CaseVerdict, string>> = {
  error: cssVar.colorWarning,
  failed: cssVar.colorError,
  passed: cssVar.colorSuccess,
  pending: cssVar.colorFillSecondary,
  running: cssVar.colorPrimary,
};

type Filter = CaseVerdict | 'all';

interface CaseResultsTableProps {
  benchmarkId: string;
  k?: number;
  onResumeCase?: (testCaseId: string, threadId?: string) => Promise<void>;
  onRetryCase?: (testCaseId: string) => Promise<void>;
  /** Provider the run used — fills `{{provider}}` in localized runtime errors. */
  provider?: string | null;
  results: any[];
  runId: string;
  runStatus?: string;
}

const CaseResultsTable = ({
  results,
  benchmarkId,
  runId,
  k = 1,
  onRetryCase,
  onResumeCase,
  provider,
  runStatus,
}: CaseResultsTableProps) => {
  const { t } = useTranslation('eval');
  const [searchText, setSearchText] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pageSize, setPageSize] = useState(20);

  const counts = useMemo(() => countVerdicts(results), [results]);

  const filteredResults = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return results.filter((r: any) => {
      if (filter !== 'all' && getCaseVerdict(r.status) !== filter) return false;
      if (query && !r.testCase?.content?.input?.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [results, searchText, filter]);

  const caseHref = useCallback(
    (testCaseId: string) => `/eval/bench/${benchmarkId}/runs/${runId}/cases/${testCaseId}`,
    [benchmarkId, runId],
  );

  const columns = useColumns({
    caseHref,
    k,
    onResumeCase,
    onRetryCase,
    provider,
    runStatus,
  });

  // Offer a verdict only when some case has it — plus the three outcomes that
  // always matter, so "0 errors" reads as a fact rather than a missing option.
  const filterOptions = [
    {
      label: (
        <span>
          {t('table.filter.all')}
          <span className={styles.count}>{results.length}</span>
        </span>
      ),
      value: 'all' as Filter,
    },
    ...VERDICT_FILTERS.filter(
      (v) => counts[v] > 0 || v === 'passed' || v === 'failed' || v === 'error',
    ).map((v) => ({
      label: (
        <Flexbox horizontal align="center">
          <span
            className={styles.dot}
            style={{ background: BAR_COLOR[v] ?? cssVar.colorTextQuaternary }}
          />
          {t(VERDICT_META[v].labelKey as any)}
          <span className={styles.count}>{counts[v]}</span>
        </Flexbox>
      ),
      value: v as Filter,
    })),
  ];

  const segments = (['passed', 'failed', 'error', 'running', 'pending'] as const).map((v) => ({
    color: BAR_COLOR[v]!,
    value: counts[v],
  }));

  return (
    <div className={styles.panel}>
      <Flexbox className={styles.toolbar} gap={12}>
        <SegmentBar segments={segments} />
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Segmented
            options={filterOptions}
            size="small"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
          />
          <Input
            allowClear
            placeholder={t('table.search.placeholder')}
            prefix={<Icon icon={SearchIcon} size={14} />}
            style={{ width: 220 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </Flexbox>
      </Flexbox>
      {filteredResults.length === 0 ? (
        <Flexbox padding={16}>
          <EvalEmpty
            compact
            icon={ListFilter}
            title={t('run.results.noMatch')}
            action={
              <Button
                size="small"
                onClick={() => {
                  setFilter('all');
                  setSearchText('');
                }}
              >
                {t('run.results.clearFilter')}
              </Button>
            }
          />
        </Flexbox>
      ) : (
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
      )}
    </div>
  );
};

export default CaseResultsTable;
