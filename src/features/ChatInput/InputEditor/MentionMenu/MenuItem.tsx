import type { ISlashMenuOption } from '@lobehub/editor';
import { cx } from 'antd-style';
import { createElement, isValidElement, type MouseEvent, type ReactNode } from 'react';
import { memo } from 'react';

import { useStyles } from './style';

interface MenuItemProps {
  active?: boolean;
  extra?: ReactNode;
  item: ISlashMenuOption;
  onClick: (item: ISlashMenuOption) => void;
}

const MenuItem = memo<MenuItemProps>(({ item, active, extra, onClick }) => {
  const { styles } = useStyles();
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  return (
    <div
      aria-selected={active}
      className={cx(styles.item, active && styles.itemActive)}
      data-key={item.key}
      id={`mention-item-${item.key}`}
      role="option"
      onClick={() => onClick(item)}
      onMouseDown={handleMouseDown}
    >
      {item.icon && (
        <span className={styles.itemIcon}>
          {isValidElement(item.icon)
            ? item.icon
            : typeof item.icon === 'function'
              ? createElement(item.icon)
              : item.icon}
        </span>
      )}
      <span className={styles.itemLabel}>{item.label}</span>
      {extra}
    </div>
  );
});

MenuItem.displayName = 'MenuItem';

export default MenuItem;
