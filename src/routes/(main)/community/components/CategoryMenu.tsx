'use client';

import { type MenuProps } from '@lobehub/ui';
import { Menu } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => {
  return {
    menu: css`
      padding: 0 !important;
      .${prefixCls}-menu-item {
        display: flex;
        gap: 4px;

        width: 100%;
        height: 36px;
        margin-inline: 0;
        padding-inline-start: 12px !important;

        font-size: 14px;

        .${prefixCls}-menu-title-content > a {
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    `,
  };
});

const CategoryMenu = memo<MenuProps>(({ style, ...rest }) => {
  return (
    <Menu
      className={styles.menu}
      data-testid="category-menu"
      mode="inline"
      style={style}
      {...rest}
    />
  );
});

export default CategoryMenu;
