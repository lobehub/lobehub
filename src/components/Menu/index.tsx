import { type MenuProps as AntdMenuProps } from 'antd';
import { ConfigProvider, Menu as AntdMenu } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  compact: css`
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  `,
  menu: css`
    flex: 1;
    border: none !important;
    background: transparent;

    .${prefixCls}-menu-item-divider {
      margin-block: 0.125rem;
      border-color: ${cssVar.colorFillTertiary};

      &:first-child {
        margin-block-start: 0;
      }

      &:last-child {
        margin-block-end: 0;
      }
    }

    .${prefixCls}-menu-item, .${prefixCls}-menu-submenu-title {
      display: flex;
      gap: 0.75rem;
      align-items: center;

      height: unset;
      min-height: 2rem;
      padding-block: 0.375rem;
      padding-inline: 0.75rem;

      line-height: 2;

      .anticon + .${prefixCls}-menu-title-content {
        margin-inline-start: 0;
      }
    }

    .${prefixCls}-menu-item-selected {
      .${prefixCls}-menu-item-icon svg {
        color: ${cssVar.colorText};
      }
    }

    .${prefixCls}-menu-item-icon svg {
      color: ${cssVar.colorTextSecondary};
    }

    .${prefixCls}-menu-title-content {
      flex: 1;
    }
  `,
}));

export interface MenuProps extends AntdMenuProps {
  compact?: boolean;
}

const Menu = memo<MenuProps>(({ className, selectable = false, compact, ...rest }) => {
  return (
    <ConfigProvider
      theme={{
        components: {
          Menu: {
            controlHeightLG: 36,
            iconMarginInlineEnd: 8,
            iconSize: 16,
            itemBorderRadius: 8,
            itemColor: selectable ? cssVar.colorTextSecondary : cssVar.colorText,
            itemHoverBg: cssVar.colorFillTertiary,
            itemMarginBlock: compact ? 0 : 4,
            itemMarginInline: compact ? 0 : 4,
            itemSelectedBg: cssVar.colorFillSecondary,
            paddingXS: -8,
          },
        },
      }}
    >
      <AntdMenu
        className={cx(styles.menu, compact && styles.compact, className)}
        mode="vertical"
        selectable={selectable}
        {...rest}
      />
    </ConfigProvider>
  );
});

export default Menu;
