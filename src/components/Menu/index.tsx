import { List, type ListProps } from '@lobehub/ui';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';

import styles from './Menu.module.css';

export type MenuProps = ListProps;

const Menu = memo<MenuProps>(
  ({ className, compact, selectable = false, styles: customStyles, ...rest }) => (
    <List
      className={cx(!compact && styles.inset, className)}
      compact={compact}
      selectable={selectable}
      styles={
        selectable
          ? customStyles
          : { ...customStyles, item: { color: cssVar.colorText, ...customStyles?.item } }
      }
      {...rest}
    />
  ),
);

export default Menu;
