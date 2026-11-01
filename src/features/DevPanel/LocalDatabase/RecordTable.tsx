'use client';

import { Button, Input } from '@lobehub/ui';
import { RefreshCw } from 'lucide-react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import {
  formatLocalDatabaseCellValue,
  type LocalDatabaseColumn,
  type LocalDatabaseTableRow,
} from './model';

export const MAX_RENDERED_ROWS = 300;

interface RecordTableProps {
  columns: LocalDatabaseColumn[];
  isLoading: boolean;
  matchingCount: number;
  onRefresh: () => void;
  onRowSearchChange: (value: string) => void;
  onSelect: (key: string) => void;
  rows: LocalDatabaseTableRow[];
  rowSearch: string;
  selectedKey: string | undefined;
  title: string;
  totalCount: number;
}

const columnWidth = ({ label }: LocalDatabaseColumn): number => {
  if (label === 'key') return 260;
  if (label === 'resource' || label === 'id' || label === 'query') return 200;
  if (label === 'scope') return 160;
  if (label === 'version') return 80;
  if (label === 'updatedAt') return 200;
  return 240;
};

const RecordTable = ({
  columns,
  isLoading,
  matchingCount,
  onRefresh,
  onRowSearchChange,
  onSelect,
  rowSearch,
  rows,
  selectedKey,
  title,
  totalCount,
}: RecordTableProps) => {
  const tableWidth = columns.reduce((total, column) => total + columnWidth(column), 0);
  const rowRange = matchingCount === 0 ? '0 rows' : `1–${rows.length} of ${matchingCount} rows`;

  return (
    <main className={styles.tablePane}>
      <div className={devDockPanelStyles.toolbar}>
        <span className={styles.tableName} title={title}>
          {title}
        </span>
        <Input
          allowClear
          className={styles.toolbarSearch}
          placeholder={'Search rows…'}
          size={'small'}
          style={{ flex: 1 }}
          value={rowSearch}
          onChange={(event) => onRowSearchChange(event.target.value)}
        />
        <span className={styles.toolbarMeta}>{totalCount} rows</span>
        <span className={styles.toolbarMeta}>read-only</span>
        <Button
          icon={RefreshCw}
          loading={isLoading}
          size={'small'}
          type={'text'}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
      <div className={styles.tableScroll}>
        <table
          className={styles.table}
          style={{ minWidth: '100%', width: Math.max(tableWidth, 640) }}
        >
          <colgroup>
            {columns.map((column) => (
              <col key={column.id} style={{ width: columnWidth(column) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} scope={'col'} title={column.label}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const active = row.entry.key === selectedKey;

              return (
                <tr
                  aria-label={row.entry.key}
                  aria-selected={active}
                  className={active ? styles.rowActive : undefined}
                  key={row.entry.key}
                  tabIndex={0}
                  onClick={() => onSelect(row.entry.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(row.entry.key);
                    }
                  }}
                >
                  {columns.map((column) => {
                    const field = row.fields.find(({ id }) => id === column.id);
                    const text = formatLocalDatabaseCellValue(field?.value);

                    return (
                      <td key={column.id} title={text}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className={styles.tableEmpty}>
            {rowSearch ? `No rows match “${rowSearch}”.` : 'This collection is empty.'}
          </div>
        )}
      </div>
      <div className={devDockPanelStyles.statusBar}>
        <span>{rowRange}</span>
        {matchingCount > MAX_RENDERED_ROWS && <span>Refine the search to inspect later rows.</span>}
      </div>
    </main>
  );
};

export default RecordTable;
