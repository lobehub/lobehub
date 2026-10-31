'use client';

import { Button, Input } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { RefreshCw } from 'lucide-react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import tableStyles from '../inspectorTable.module.css';
import { describeReplicaValue, type ReplicaEntryRow } from './model';
import { MAX_RENDERED_ENTRIES } from './useReplicaInspector';

interface EntryTableProps {
  matchingCount: number;
  onRevalidate: (() => void) | undefined;
  onSearchChange: (value: string) => void;
  onSelect: (key: string) => void;
  rows: ReplicaEntryRow[];
  search: string;
  selectedKey: string | undefined;
  title: string;
  totalCount: number;
}

const COLUMNS = [
  { label: 'key', width: 240 },
  { label: 'source', width: 80 },
  { label: 'pending', width: 72 },
  { label: 'query', width: 200 },
  { label: 'updatedAt', width: 200 },
  { label: 'value', width: 200 },
] as const;

const TABLE_WIDTH = COLUMNS.reduce((total, { width }) => total + width, 0);

const cellsOf = (row: ReplicaEntryRow): string[] => [
  row.key,
  row.source,
  String(row.pending),
  row.query ?? '—',
  row.updatedAt?.toISOString() ?? '—',
  describeReplicaValue(row.data),
];

const EntryTable = ({
  matchingCount,
  onRevalidate,
  onSearchChange,
  onSelect,
  rows,
  search,
  selectedKey,
  title,
  totalCount,
}: EntryTableProps) => (
  <main {...stylex.props(styles.tablePane)}>
    <div {...stylex.props(devDockPanelStyles.toolbar)}>
      <span {...stylex.props(styles.tableName)} title={title}>
        {title}
      </span>
      <Input
        allowClear
        className={stylex.props(styles.toolbarSearch).className}
        placeholder={'Search key, query, source…'}
        size={'small'}
        style={{ flex: 1 }}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <span {...stylex.props(styles.toolbarMeta)}>{totalCount} entries · live</span>
      <Button
        disabled={!onRevalidate}
        icon={RefreshCw}
        size={'small'}
        title={'Re-run the mounted useSync queries of this resource'}
        type={'text'}
        onClick={onRevalidate}
      >
        Revalidate
      </Button>
    </div>
    <div {...stylex.props(styles.tableScroll)}>
      <table className={tableStyles.table} style={{ minWidth: '100%', width: TABLE_WIDTH }}>
        <colgroup>
          {COLUMNS.map(({ label, width }) => (
            <col key={label} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map(({ label }) => (
              <th key={label} scope={'col'}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const active = row.key === selectedKey;

            return (
              <tr
                aria-label={row.key}
                aria-selected={active}
                {...stylex.props(active ? styles.rowActive : undefined)}
                key={row.key}
                tabIndex={0}
                onClick={() => onSelect(row.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(row.key);
                  }
                }}
              >
                {cellsOf(row).map((text, index) => (
                  <td key={COLUMNS[index].label} title={text}>
                    {text}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div {...stylex.props(styles.tableEmpty)}>
          {search ? `No entries match “${search}”.` : 'This replica holds no entries.'}
        </div>
      )}
    </div>
    <div {...stylex.props(devDockPanelStyles.statusBar)}>
      <span>{matchingCount === 0 ? '0 entries' : `1–${rows.length} of ${matchingCount}`}</span>
      {matchingCount > MAX_RENDERED_ENTRIES && (
        <span>Refine the search to inspect later entries.</span>
      )}
    </div>
  </main>
);

export default EntryTable;
