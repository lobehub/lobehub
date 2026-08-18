import { ProviderIcon } from '@lobehub/icons';
import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { type TableColumnType } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import SpendType, { type SpendTypeValue } from '@/components/SpendType';
import TablePagination from '@/components/TablePagination';
import TotalToken from '@/components/TotalToken';
import { parseAsInteger, useQueryStates } from '@/hooks/useQueryParam';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';
import { formatNumber, formatSpendTime } from '@/utils/format';

import { type UsageChartProps } from '../../types';

/** Sizes small enough to keep the table from crowding out the rest of the page. */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

/**
 * Sortable columns and the number each row sorts by. Pagination is ours now, so
 * antd only ever sees one page — sorting has to run over the whole result set
 * here, before it gets sliced.
 */
const SORT_VALUES: Record<string, (row: any) => number> = {
  createdAt: (row) => new Date(row.createdAt).getTime(),
  spend: (row) => row.spend ?? 0,
  totalTokens: (row) => row.totalTokens ?? 0,
};

interface SortState {
  field: string;
  order: 'ascend' | 'descend';
}

const styles = createStaticStyles(({ css }) => ({
  // Line the footer up with InlineTable's first/last cells.
  pagination: css`
    padding-inline: 24px;
  `,
}));

const UsageTable = memo<UsageChartProps>(({ dateStrings }) => {
  const { t } = useTranslation('auth');
  // Columns shared with the workspace spend breakdown read from the same
  // namespace, so the two tables stay worded alike.
  const { t: tSpend } = useTranslation('spend');

  const { data, isLoading, mutate } = useClientDataSWR(statsKeys.usageLogs(), async () =>
    usageService.findByMonth(dateStrings),
  );

  // Page and page size move together — the size picker keeps the first visible
  // row in view, so it recalculates the page as well. One update, one
  // navigation: see `useQueryStates`.
  const [{ current: currentPage, pageSize }, setPagination] = useQueryStates(
    {
      current: parseAsInteger.withDefault(1),
      pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
    },
    { clearOnDefault: true },
  );
  const [sort, setSort] = useState<SortState | null>(null);

  useEffect(() => {
    if (dateStrings) {
      mutate();
    }
  }, [dateStrings]);

  const sorted = useMemo(() => {
    const getValue = sort && SORT_VALUES[sort.field];
    if (!data || !getValue) return data;

    const direction = sort.order === 'ascend' ? 1 : -1;
    return [...data].sort((a, b) => (getValue(a) - getValue(b)) * direction);
  }, [data, sort]);

  const total = sorted?.length ?? 0;
  // A shrinking result set can leave `currentPage` past the end; clamp for
  // display so the table never goes blank while the URL catches up.
  const page = Math.min(currentPage, Math.max(1, Math.ceil(total / pageSize)));
  const pageData = useMemo(
    () => sorted?.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  // Column order mirrors the workspace spend breakdown: when it happened, what
  // it was, which model, how many tokens, what it cost, how fast.
  const columns: TableColumnType<any>[] = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value) => <span style={{ textWrap: 'nowrap' }}>{formatSpendTime(value)}</span>,
      sorter: true,
      sortOrder: sort?.field === 'createdAt' ? sort.order : null,
      title: tSpend('table.columns.time'),
      width: 150,
    },
    {
      dataIndex: 'type',
      key: 'type',
      render: (value: SpendTypeValue) => (
        <SpendType type={value}>{tSpend(`table.columns.type.enums.${value}`)}</SpendType>
      ),
      title: tSpend('table.columns.type.title'),
      width: 80,
    },
    {
      dataIndex: 'model',
      key: 'model',
      render: (value, record) => (
        <Flexbox horizontal align={'center'} gap={16}>
          <ProviderIcon
            provider={record.provider}
            size={18}
            style={{
              border: `2px solid ${cssVar.colorBgContainer}`,
              boxSizing: 'content-box',
              marginRight: -8,
            }}
          />
          <Tooltip title={value}>
            <Text>{value?.length > 12 ? `${value.slice(0, 12)}...` : value}</Text>
          </Tooltip>
        </Flexbox>
      ),
      title: tSpend('table.columns.model'),
    },
    {
      dataIndex: 'totalTokens',
      key: 'totalTokens',
      render: (value, record) => (
        <TotalToken
          totalInputTokens={record.totalInputTokens}
          totalOutputTokens={record.totalOutputTokens}
          totalTokens={value ?? 0}
        />
      ),
      sorter: true,
      sortOrder: sort?.field === 'totalTokens' ? sort.order : null,
      title: tSpend('table.columns.totalTokens'),
      width: 180,
    },
    {
      align: 'end',
      dataIndex: 'spend',
      key: 'spend',
      // Kept in dollars, unlike the workspace breakdown's credits column.
      render: (value) => `$${formatNumber(value, 6)}`,
      sorter: true,
      sortOrder: sort?.field === 'spend' ? sort.order : null,
      title: t('usage.table.spend'),
    },
    {
      align: 'end',
      dataIndex: 'tps',
      key: 'tps',
      render: (value) => (value ? formatNumber(value, 2) : '--'),
      title: t('usage.table.tps'),
    },
    {
      align: 'end',
      dataIndex: 'ttft',
      key: 'ttft',
      render: (value) => (value ? formatNumber(value / 1000, 2) : '--'),
      title: t('usage.table.ttft'),
    },
  ];

  return (
    <>
      <InlineTable
        columns={columns}
        dataSource={pageData}
        loading={isLoading}
        rowKey={(record) => record.id || `${record.model}-${record.createdAt}-${record.provider}`}
        size="small"
        onChange={(_pagination, _filters, sorter) => {
          const next = Array.isArray(sorter) ? sorter[0] : sorter;
          const field = String(next?.columnKey ?? '');
          setSort(next?.order && SORT_VALUES[field] ? { field, order: next.order } : null);
          // A re-sort makes the current page a different set of rows; start
          // from the top rather than dropping the reader into the middle.
          setPagination({ current: 1 });
        }}
      />
      {total > 0 && (
        <TablePagination
          className={styles.pagination}
          current={page}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          total={total}
          onChange={(nextPage, nextPageSize) =>
            setPagination({ current: nextPage, pageSize: nextPageSize })
          }
        />
      )}
    </>
  );
});

export default UsageTable;
