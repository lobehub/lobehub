import { cx, Skeleton } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';

import styles from './LiteTable.module.css';

/** Placeholder rows shown before the first load settles. */
const SKELETON_ROWS = 4;

export interface LiteTableColumn<RecordType> {
  key: string;
  listLabel?: string | false;
  listSlot?: 'actions' | 'extra' | 'title';
  render: (record: RecordType, index: number) => ReactNode;
  title: ReactNode;
  width?: number | string;
}

export interface LiteTableProps<RecordType> {
  className?: string;
  columns: LiteTableColumn<RecordType>[];
  dataSource?: RecordType[];
  emptyText?: ReactNode;
  /** Switch to cards sooner when a table has multiple metadata and action columns. */
  listBreakpoint?: 600 | 800;
  loading?: boolean;
  /**
   * Makes every data row clickable. Interactive cell content (buttons,
   * switches, editable cells) must stopPropagation to keep working.
   */
  onRowClick?: (record: RecordType) => void;
  rowKey: (record: RecordType) => string;
  /** Fixed layout prevents long cell content from pushing other columns offscreen. */
  tableLayout?: 'auto' | 'fixed';
}

const LiteTableInner = <RecordType,>({
  className,
  columns,
  dataSource,
  emptyText,
  loading,
  listBreakpoint = 600,
  tableLayout = 'auto',
  onRowClick,
  rowKey,
}: LiteTableProps<RecordType>) => {
  const items = dataSource ?? [];
  const initialLoading = !!loading && items.length === 0;

  const listLabelOf = (column: LiteTableColumn<RecordType>) =>
    column.listSlot || column.listLabel === false
      ? undefined
      : (column.listLabel ?? (typeof column.title === 'string' ? column.title : undefined));

  return (
    <div aria-busy={initialLoading} className={cx(styles.container, className)}>
      {!initialLoading && items.length === 0 ? (
        emptyText
      ) : (
        // The loading state keeps the table chrome and skeletonises only the
        // cells, so settling is a content swap rather than a relayout (ux §4.1).
        <div className={styles.body}>
          <table
            className={cx(
              styles.table,
              tableLayout === 'fixed' && styles.fixedTable,
              listBreakpoint === 800 && styles.wideList,
            )}
          >
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} style={{ width: column.width }}>
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {initialLoading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td
                          data-label={listLabelOf(column)}
                          data-list-slot={column.listSlot}
                          key={column.key}
                        >
                          <Skeleton style={{ height: 14, minWidth: 0, width: '100%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : items.map((record, index) => (
                    <tr
                      className={onRowClick ? styles.clickableRow : undefined}
                      key={rowKey(record)}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? () => onRowClick(record) : undefined}
                      onKeyDown={
                        onRowClick
                          ? (event) => {
                              // only the row itself — a key pressed inside a cell
                              // control (switch, button, input) belongs to it
                              if (event.target !== event.currentTarget) return;
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              onRowClick(record);
                            }
                          : undefined
                      }
                    >
                      {columns.map((column) => (
                        <td
                          data-label={listLabelOf(column)}
                          data-list-slot={column.listSlot}
                          key={column.key}
                        >
                          {column.render(record, index)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const LiteTable = memo(LiteTableInner) as typeof LiteTableInner;

export default LiteTable;
