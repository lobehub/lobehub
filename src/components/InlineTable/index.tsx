import { Table, type TableProps } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';

const styles = createStaticStyles(({ css, cssVar }) => ({
  hoverToActive: css`
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  `,
  table: css`
    table {
      font-size: 13px;
    }

    th {
      background: transparent;
      box-shadow: inset 0 999px 0 ${cssVar.colorFillQuaternary};
    }

    td {
      border: none;
      background: transparent;
    }

    tr:hover > td {
      background: ${cssVar.colorFillQuaternary};
    }

    tr {
      td:first-child,
      th:first-child {
        padding-inline-start: 24px;
      }

      td:last-child,
      th:last-child {
        padding-inline-end: 24px;
      }
    }
  `,
}));

export type InlineTableProps<T> = TableProps<T> & { hoverToActive?: boolean };

const InlineTable = <T extends object>({
  hoverToActive,
  className,
  ...rest
}: InlineTableProps<T>) => (
  <Table<T>
    className={cx(styles.table, hoverToActive && styles.hoverToActive, className)}
    pagination={false}
    size={'small'}
    {...rest}
  />
);

export default InlineTable;
