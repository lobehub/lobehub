import { List, type ListProps } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

export type MenuProps = ListProps;

const Menu = memo<MenuProps>(({ selectable = false, styles, ...rest }) => (
  <List
    selectable={selectable}
    styles={selectable ? styles : { ...styles, item: { color: cssVar.colorText, ...styles?.item } }}
    {...rest}
  />
));

export default Menu;
