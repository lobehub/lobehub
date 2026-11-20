'use client';

import type { WidgetTableOutput } from '@lobechat/types';
import { createStaticStyles, cssVar, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCell } from '../../utils/format';
import { useIncrementalRows } from './useIncrementalRows';

const styles = createStaticStyles(({ css }) => ({
  table: css`
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;

    th,
    td {
      overflow: hidden;

      max-width: 240px;
      padding-block: 6px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillQuaternary};
    }

    td[data-type='number'],
    th[data-type='number'] {
      font-variant-numeric: tabular-nums;
      text-align: end;
    }
  `,
  wrapper: css`
    overflow: auto;
    width: 100%;
  `,
}));

interface TableViewProps {
  /** Column keys to show, in order (`view.columns`). */
  columns?: string[];
  /** Reveal rows in batches as the card is scrolled instead of mounting them all. */
  incremental?: boolean;
  limit?: number;
  output: WidgetTableOutput;
}

const TableView = memo<TableViewProps>(({ output, columns, limit, incremental }) => {
  const { t } = useTranslation('dashboard');

  const visibleColumns = useMemo(() => {
    if (!columns?.length) return output.columns;
    const byKey = new Map(output.columns.map((column) => [column.key, column]));
    return columns.map((key) => byKey.get(key) ?? { key });
  }, [columns, output.columns]);

  const capped = limit ? output.rows.slice(0, limit) : output.rows;
  const { count, hasMore, sentinelRef } = useIncrementalRows(capped.length, !!incremental);
  const rows = capped.slice(0, count);
  const hidden = output.rows.length - capped.length;

  if (output.rows.length === 0) {
    return (
      <Text fontSize={12} type={'secondary'}>
        {t('widget.view.tableEmpty')}
      </Text>
    );
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th data-type={column.type} key={column.key}>
                {column.title ?? column.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {visibleColumns.map((column) => {
                const text = formatCell(row[column.key]);
                return (
                  <td data-type={column.type} key={column.key} title={text}>
                    {column.type === 'link' && text ? (
                      <a href={text} rel={'noreferrer'} target={'_blank'}>
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && <div key={count} ref={sentinelRef} style={{ height: 1 }} />}
      {hidden > 0 && !hasMore && (
        <Text fontSize={12} style={{ display: 'block', paddingTop: 6 }} type={'secondary'}>
          {t('widget.view.more', { count: hidden })}
        </Text>
      )}
    </div>
  );
});

TableView.displayName = 'DashboardTableView';

export default TableView;
