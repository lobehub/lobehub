import { Table, type TableProps } from '@lobehub/ui';
import { cx } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';

import { sx } from '@/styles/sx';

import styles from './InlineTable.module.css';

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
      sx([hoverToActive && hoverStyles.hoverToActive], cx(styles.table, className)).className
    }
    {...rest}
  />
);

export default InlineTable;
