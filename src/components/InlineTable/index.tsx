import './InlineTable.css';

import { cx, Table, type TableProps } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

const hoverStyles = stylex.create({
  hoverToActive: {
    opacity: { 'default': 0.6, ':hover': 1 },
  },
});

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
      sx(
        hoverToActive && hoverStyles.hoverToActive,
        cx('lobe-inline-table-b75cf865-table', className),
      ).className
    }
    {...rest}
  />
);

export default InlineTable;
