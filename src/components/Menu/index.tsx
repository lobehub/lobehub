import './Menu.css';

import { cx, List, type ListProps } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';

export type MenuProps = ListProps;

const Menu = memo<MenuProps>(
  ({ className, compact, selectable = false, styles: customStyles, ...rest }) => (
    <List
      className={cx(!compact && 'lobe-menu-8b666d35-inset', className)}
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
