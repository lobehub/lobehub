'use client';

import { List, type ListClickInfo, type ListItemType } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, memo } from 'react';

const styles = stylex.create({ item: { minHeight: '36px' } });

export interface CategoryMenuProps {
  className?: string;
  items: ListItemType[];
  mode?: 'inline';
  onClick?: (info: ListClickInfo) => void;
  selectedKeys?: string[];
  style?: CSSProperties;
}

const CategoryMenu = memo<CategoryMenuProps>(
  ({ className, items, onClick, selectedKeys, style }) => {
    return (
      <List
        activeKey={selectedKeys?.[0]}
        className={className}
        classNames={{ item: stylex.props(styles.item).className }}
        data-testid="category-menu"
        items={items}
        style={style}
        onClick={onClick}
      />
    );
  },
);

export default CategoryMenu;
