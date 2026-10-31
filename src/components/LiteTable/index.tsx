import { Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const styles = stylex.create({
  body: { overflowX: 'auto' },
  clickableRow: {
    cursor: 'pointer',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  container: { containerType: 'inline-size' },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    minWidth: { 'default': 'max-content', '@container (max-width: 600px)': '0' },
    fontSize: '13px',
    display: { 'default': null, '@container (max-width: 600px)': 'block' },
  },
  cell: {
    'paddingBlockStart': {
      'default': '8px',
      '@container (max-width: 600px)': {
        'default': '6px',
        ":is([data-list-slot='title'])": '8px',
        ":is([data-list-slot='extra'])": '8px',
      },
    },
    'paddingBlockEnd': {
      'default': '8px',
      '@container (max-width: 600px)': {
        'default': '6px',
        ":is([data-list-slot='title'])": '8px',
        ":is([data-list-slot='extra'])": '8px',
      },
    },
    'paddingInlineStart': {
      'default': '8px',
      ':first-child': '24px',
      '@container (max-width: 600px)': '0',
    },
    'paddingInlineEnd': {
      'default': '8px',
      ':last-child': '24px',
      '@container (max-width: 600px)': '0',
    },
    'textAlign': 'start',
    'verticalAlign': 'middle',
    'display': { 'default': null, '@container (max-width: 600px)': 'flex' },
    'gridColumn': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': '1 / -1',
        ":is([data-list-slot='title'])": '1',
        ":is([data-list-slot='extra'])": '2',
      },
    },
    'gap': { 'default': null, '@container (max-width: 600px)': '16px' },
    'alignItems': { 'default': null, '@container (max-width: 600px)': 'center' },
    'justifyContent': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': 'space-between',
        ':not([data-label], [data-list-slot])': 'flex-end',
        ":is([data-list-slot='title'])": 'flex-start',
        ":is([data-list-slot='extra'])": 'flex-end',
        ":is([data-list-slot='actions'])": 'flex-end',
      },
    },
    'gridRow': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': null,
        ":is([data-list-slot='title'])": '1',
        ":is([data-list-slot='extra'])": '1',
      },
    },
    'borderBlockEndWidth': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': null,
        ":is([data-list-slot='title'])": '1px',
        ":is([data-list-slot='extra'])": '1px',
      },
    },
    'borderBlockEndStyle': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': null,
        ":is([data-list-slot='title'])": 'solid',
        ":is([data-list-slot='extra'])": 'solid',
      },
    },
    'borderBlockEndColor': {
      'default': null,
      '@container (max-width: 600px)': {
        'default': null,
        ":is([data-list-slot='title'])": cssVar.colorBorderSecondary,
        ":is([data-list-slot='extra'])": cssVar.colorBorderSecondary,
      },
    },
    'fontSize': {
      'default': null,
      '@container (max-width: 600px)': { 'default': null, ":is([data-list-slot='title'])": '14px' },
    },
    'fontWeight': {
      'default': null,
      '@container (max-width: 600px)': { 'default': null, ":is([data-list-slot='title'])": 600 },
    },
    '::before': {
      content: {
        'default': null,
        '@container (max-width: 600px)': {
          'default': null,
          ':is([data-label])': 'attr(data-label)',
        },
      },
      flexShrink: {
        'default': null,
        '@container (max-width: 600px)': { 'default': null, ':is([data-label])': 0 },
      },
      color: {
        'default': null,
        '@container (max-width: 600px)': {
          'default': null,
          ':is([data-label])': cssVar.colorTextSecondary,
        },
      },
    },
  },
  heading: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '8px',
    paddingInlineStart: { 'default': '8px', ':first-child': '24px' },
    paddingInlineEnd: { 'default': '8px', ':last-child': '24px' },
    textAlign: 'start',
    verticalAlign: 'middle',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  row: {
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillQuaternary,
      '@container (max-width: 600px)': { 'default': null, ':hover': 'transparent' },
    },
    backgroundImage: {
      'default': null,
      ':hover': 'none',
      '@container (max-width: 600px)': { 'default': null, ':hover': 'none' },
    },
    display: { 'default': null, '@container (max-width: 600px)': 'grid' },
    gridTemplateColumns: { 'default': null, '@container (max-width: 600px)': '1fr auto' },
    alignItems: { 'default': null, '@container (max-width: 600px)': 'center' },
    paddingBlockStart: { 'default': null, '@container (max-width: 600px)': '4px' },
    paddingBlockEnd: { 'default': null, '@container (max-width: 600px)': '8px' },
    paddingInlineStart: { 'default': null, '@container (max-width: 600px)': '16px' },
    paddingInlineEnd: { 'default': null, '@container (max-width: 600px)': '16px' },
    borderWidth: { 'default': null, '@container (max-width: 600px)': '1px' },
    borderStyle: { 'default': null, '@container (max-width: 600px)': 'solid' },
    borderColor: { 'default': null, '@container (max-width: 600px)': cssVar.colorBorderSecondary },
    borderRadius: { 'default': null, '@container (max-width: 600px)': cssVar.borderRadiusLG },
  },
  wideTable: {
    borderCollapse: 'collapse',
    width: '100%',
    minWidth: { 'default': 'max-content', '@container (max-width: 800px)': '0' },
    fontSize: '13px',
    display: { 'default': null, '@container (max-width: 800px)': 'block' },
  },
  wideCell: {
    'paddingBlockStart': {
      'default': '8px',
      '@container (max-width: 800px)': {
        'default': '6px',
        ":is([data-list-slot='title'])": '8px',
        ":is([data-list-slot='extra'])": '8px',
      },
    },
    'paddingBlockEnd': {
      'default': '8px',
      '@container (max-width: 800px)': {
        'default': '6px',
        ":is([data-list-slot='title'])": '8px',
        ":is([data-list-slot='extra'])": '8px',
      },
    },
    'paddingInlineStart': {
      'default': '8px',
      ':first-child': '24px',
      '@container (max-width: 800px)': '0',
    },
    'paddingInlineEnd': {
      'default': '8px',
      ':last-child': '24px',
      '@container (max-width: 800px)': '0',
    },
    'textAlign': 'start',
    'verticalAlign': 'middle',
    'display': { 'default': null, '@container (max-width: 800px)': 'flex' },
    'gridColumn': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': '1 / -1',
        ":is([data-list-slot='title'])": '1',
        ":is([data-list-slot='extra'])": '2',
      },
    },
    'gap': { 'default': null, '@container (max-width: 800px)': '16px' },
    'alignItems': { 'default': null, '@container (max-width: 800px)': 'center' },
    'justifyContent': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': 'space-between',
        ':not([data-label], [data-list-slot])': 'flex-end',
        ":is([data-list-slot='title'])": 'flex-start',
        ":is([data-list-slot='extra'])": 'flex-end',
        ":is([data-list-slot='actions'])": 'flex-end',
      },
    },
    'gridRow': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': null,
        ":is([data-list-slot='title'])": '1',
        ":is([data-list-slot='extra'])": '1',
      },
    },
    'borderBlockEndWidth': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': null,
        ":is([data-list-slot='title'])": '1px',
        ":is([data-list-slot='extra'])": '1px',
      },
    },
    'borderBlockEndStyle': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': null,
        ":is([data-list-slot='title'])": 'solid',
        ":is([data-list-slot='extra'])": 'solid',
      },
    },
    'borderBlockEndColor': {
      'default': null,
      '@container (max-width: 800px)': {
        'default': null,
        ":is([data-list-slot='title'])": cssVar.colorBorderSecondary,
        ":is([data-list-slot='extra'])": cssVar.colorBorderSecondary,
      },
    },
    'fontSize': {
      'default': null,
      '@container (max-width: 800px)': { 'default': null, ":is([data-list-slot='title'])": '14px' },
    },
    'fontWeight': {
      'default': null,
      '@container (max-width: 800px)': { 'default': null, ":is([data-list-slot='title'])": 600 },
    },
    '::before': {
      content: {
        'default': null,
        '@container (max-width: 800px)': {
          'default': null,
          ':is([data-label])': 'attr(data-label)',
        },
      },
      flexShrink: {
        'default': null,
        '@container (max-width: 800px)': { 'default': null, ':is([data-label])': 0 },
      },
      color: {
        'default': null,
        '@container (max-width: 800px)': {
          'default': null,
          ':is([data-label])': cssVar.colorTextSecondary,
        },
      },
    },
  },
  wideHeading: {
    paddingBlockStart: '8px',
    paddingBlockEnd: '8px',
    paddingInlineStart: { 'default': '8px', ':first-child': '24px' },
    paddingInlineEnd: { 'default': '8px', ':last-child': '24px' },
    textAlign: 'start',
    verticalAlign: 'middle',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  wideRow: {
    backgroundColor: {
      'default': null,
      ':hover': cssVar.colorFillQuaternary,
      '@container (max-width: 800px)': { 'default': null, ':hover': 'transparent' },
    },
    backgroundImage: {
      'default': null,
      ':hover': 'none',
      '@container (max-width: 800px)': { 'default': null, ':hover': 'none' },
    },
    display: { 'default': null, '@container (max-width: 800px)': 'grid' },
    gridTemplateColumns: { 'default': null, '@container (max-width: 800px)': '1fr auto' },
    alignItems: { 'default': null, '@container (max-width: 800px)': 'center' },
    paddingBlockStart: { 'default': null, '@container (max-width: 800px)': '4px' },
    paddingBlockEnd: { 'default': null, '@container (max-width: 800px)': '8px' },
    paddingInlineStart: { 'default': null, '@container (max-width: 800px)': '16px' },
    paddingInlineEnd: { 'default': null, '@container (max-width: 800px)': '16px' },
    borderWidth: { 'default': null, '@container (max-width: 800px)': '1px' },
    borderStyle: { 'default': null, '@container (max-width: 800px)': 'solid' },
    borderColor: { 'default': null, '@container (max-width: 800px)': cssVar.colorBorderSecondary },
    borderRadius: { 'default': null, '@container (max-width: 800px)': cssVar.borderRadiusLG },
  },
  head: { display: { 'default': null, '@container (max-width: 600px)': 'none' } },
  wideHead: { display: { 'default': null, '@container (max-width: 800px)': 'none' } },
  bodyRows: {
    display: { 'default': null, '@container (max-width: 600px)': 'flex' },
    flexDirection: { 'default': null, '@container (max-width: 600px)': 'column' },
    gap: { 'default': null, '@container (max-width: 600px)': '12px' },
    paddingInlineStart: { 'default': null, '@container (max-width: 600px)': '16px' },
    paddingInlineEnd: { 'default': null, '@container (max-width: 600px)': '16px' },
  },
  wideBodyRows: {
    display: { 'default': null, '@container (max-width: 800px)': 'flex' },
    flexDirection: { 'default': null, '@container (max-width: 800px)': 'column' },
    gap: { 'default': null, '@container (max-width: 800px)': '12px' },
    paddingInlineStart: { 'default': null, '@container (max-width: 800px)': '16px' },
    paddingInlineEnd: { 'default': null, '@container (max-width: 800px)': '16px' },
  },
  fixedTable: { tableLayout: 'fixed', minWidth: '0' },
});

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
  const wide = listBreakpoint === 800;

  const listLabelOf = (column: LiteTableColumn<RecordType>) =>
    column.listSlot || column.listLabel === false
      ? undefined
      : (column.listLabel ?? (typeof column.title === 'string' ? column.title : undefined));

  return (
    <div aria-busy={initialLoading} {...sx(styles.container, className)}>
      {!initialLoading && items.length === 0 ? (
        emptyText
      ) : (
        // The loading state keeps the table chrome and skeletonises only the
        // cells, so settling is a content swap rather than a relayout (ux §4.1).
        <div {...stylex.props(styles.body)}>
          <table
            {...stylex.props(
              wide ? styles.wideTable : styles.table,
              tableLayout === 'fixed' && styles.fixedTable,
            )}
          >
            <thead {...stylex.props(wide ? styles.wideHead : styles.head)}>
              <tr>
                {columns.map((column) => (
                  <th
                    {...sx(wide ? styles.wideHeading : styles.heading, undefined, {
                      width: column.width,
                    })}
                    key={column.key}
                  >
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody {...stylex.props(wide ? styles.wideBodyRows : styles.bodyRows)}>
              {initialLoading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <tr key={index} {...stylex.props(wide ? styles.wideRow : styles.row)}>
                      {columns.map((column) => (
                        <td
                          {...stylex.props(wide ? styles.wideCell : styles.cell)}
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
                      {...stylex.props(
                        wide ? styles.wideRow : styles.row,
                        onRowClick && styles.clickableRow,
                      )}
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
                          {...stylex.props(wide ? styles.wideCell : styles.cell)}
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
