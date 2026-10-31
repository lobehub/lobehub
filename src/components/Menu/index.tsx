import { List, type ListProps } from '@lobehub/ui';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  item: { marginInline: '4px' },
});

export type MenuProps = ListProps;

const Menu = memo<MenuProps>(
  ({ className, classNames, compact, selectable = false, styles: customStyles, ...rest }) => (
    <List
      className={className}
      compact={compact}
      selectable={selectable}
      classNames={{
        ...classNames,
        item: cx(!compact && stylex.props(styles.item).className, classNames?.item),
      }}
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
