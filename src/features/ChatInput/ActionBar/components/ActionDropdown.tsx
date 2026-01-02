'use client';

import { Dropdown, type DropdownProps } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  dropdownMenu: css`
    &.${prefixCls}-dropdown-menu {
      .${prefixCls}-dropdown-menu-item-group-list {
        margin: 0;
      }
      .${prefixCls}-avatar {
        margin-inline-end: var(--ant-margin-xs);
      }
    }
  `,
}));

export interface ActionDropdownProps extends DropdownProps {
  maxHeight?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  minWidth?: number | string;
  /**
   * 是否在挂载时预渲染弹层，避免首次触发展开时的渲染卡顿
   */
  prefetch?: boolean;
}

const ActionDropdown = memo<ActionDropdownProps>(
  ({ menu, maxHeight, minWidth, maxWidth, children, placement = 'top', minHeight, ...rest }) => {
    const isMobile = useIsMobile();

    return (
      <Dropdown
        arrow={false}
        destroyOnHidden={false}
        menu={{
          ...menu,
          className: cx(styles.dropdownMenu, menu.className),
          onClick: (e) => {
            e.domEvent.preventDefault();
            menu.onClick?.(e);
          },
          style: {
            maxHeight,
            maxWidth: isMobile ? undefined : maxWidth,
            minHeight,
            minWidth: isMobile ? undefined : minWidth,
            overflowX: 'hidden',
            overflowY: 'scroll',
            width: isMobile ? '100vw' : undefined,
            ...menu.style,
          },
        }}
        placement={isMobile ? 'top' : placement}
        {...rest}
      >
        {children}
      </Dropdown>
    );
  },
);

export default ActionDropdown;
