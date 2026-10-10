import { List, type ListProps } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from '@lobehub/ui';
import { memo } from 'react';

export type MenuProps = ListProps;

const styles = createStaticStyles(({ css }) => ({
  inset: css`
    & > li:not([role='separator']) {
      margin-inline: 4px;
    }
  `,
}));

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
