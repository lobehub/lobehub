import {
  // oxlint-disable-next-line stylex-migration/no-emotion-styles -- List renders its li items without a slot
  createStaticStyles,
  cx,
  List,
  type ListProps,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { memo } from 'react';

const fallback = createStaticStyles(({ css }) => ({
  inset: css`
    > li:not([role='separator']) {
      margin-inline: 4px;
    }
  `,
}));

export type MenuProps = ListProps;

const Menu = memo<MenuProps>(
  ({ className, compact, selectable = false, styles: customStyles, ...rest }) => (
    <List
      className={cx(!compact && fallback.inset, className)}
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
