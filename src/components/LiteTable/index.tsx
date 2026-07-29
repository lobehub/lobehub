import { Skeleton } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

const LIST_BREAKPOINT = 600;

/** Placeholder rows shown before the first load settles. */
const SKELETON_ROWS = 4;

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-x: auto;
  `,
  container: css`
    container-type: inline-size;
  `,
  table: css`
    border-collapse: collapse;
    width: 100%;
    min-width: max-content;
    font-size: 13px;

    th,
    td {
      padding-block: 8px;
      padding-inline: 8px;
      text-align: start;
      vertical-align: middle;
    }

    thead th {
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      white-space: nowrap;
      background: ${cssVar.colorFillQuaternary};
    }

    tr {
      th:first-child,
      td:first-child {
        padding-inline-start: 24px;
      }

      th:last-child,
      td:last-child {
        padding-inline-end: 24px;
      }
    }

    tbody tr:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    @container (max-width: ${LIST_BREAKPOINT}px) {
      display: block;
      min-width: 0;

      thead {
        display: none;
      }

      tbody {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-inline: 16px;
      }

      tbody tr {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;

        padding-block: 4px 8px;
        padding-inline: 16px;
        border: 1px solid ${cssVar.colorBorderSecondary};
        border-radius: ${cssVar.borderRadiusLG};

        &:hover {
          background: transparent;
        }
      }

      td {
        display: flex;
        grid-column: 1 / -1;
        gap: 16px;
        align-items: center;
        justify-content: space-between;

        padding-block: 6px;
        padding-inline: 0 !important;
      }

      td[data-label]::before {
        content: attr(data-label);
        flex-shrink: 0;
        color: ${cssVar.colorTextSecondary};
      }

      td:not([data-label], [data-list-slot]) {
        justify-content: flex-end;
      }

      td[data-list-slot='title'] {
        grid-column: 1;
        grid-row: 1;
        justify-content: flex-start;

        padding-block: 8px;
        border-block-end: 1px solid ${cssVar.colorBorderSecondary};

        font-size: 14px;
        font-weight: 600;
      }

      td[data-list-slot='extra'] {
        grid-column: 2;
        grid-row: 1;
        justify-content: flex-end;

        padding-block: 8px;
        border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      }

      td[data-list-slot='actions'] {
        justify-content: flex-end;
      }
    }
  `,
}));

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
  loading?: boolean;
  rowKey: (record: RecordType) => string;
}

const LiteTableInner = <RecordType,>({
  className,
  columns,
  dataSource,
  emptyText,
  loading,
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
          <table className={styles.table}>
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
                          <Skeleton.Button
                            active
                            size={'small'}
                            style={{ height: 14, minWidth: 0, width: '100%' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : items.map((record, index) => (
                    <tr key={rowKey(record)}>
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
