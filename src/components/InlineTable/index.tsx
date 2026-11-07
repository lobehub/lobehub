import {
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- Table renders table cells without a slot
  createStaticStyles,
  cx,
  Table,
  type TableProps,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const hoverStyles = stylex.create({
  hoverToActive: {
    opacity: { 'default': 0.6, ':hover': 1 },
  },
});

const fallback = createStaticStyles(({ css, cssVar }) => ({
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

    tr td:first-child,
    tr th:first-child {
      padding-inline-start: 24px;
    }

    tr td:last-child,
    tr th:last-child {
      padding-inline-end: 24px;
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
    pagination={false}
    size={'small'}
    className={
      sx(hoverToActive && hoverStyles.hoverToActive, cx(fallback.table, className)).className
    }
    {...rest}
  />
);

export default InlineTable;
