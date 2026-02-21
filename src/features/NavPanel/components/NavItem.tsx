'use client';

import { type BlockProps, type GenericItemType, type IconProps } from '@lobehub/ui';
import { Block, Center, ContextMenuTrigger, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

const ACTION_CLASS_NAME = 'nav-item-actions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    user-select: none;
    overflow: hidden;
    min-width: 32px;

    .${ACTION_CLASS_NAME} {
      width: 0;
      margin-inline-end: 2px;
      opacity: 0;
      transition: opacity 0.2s ${cssVar.motionEaseOut};

      &:has([data-popup-open]) {
        width: unset;
        opacity: 1;
      }
    }

    &:hover {
      .${ACTION_CLASS_NAME} {
        width: unset;
        opacity: 1;
      }
    }
  `,
}));

export interface NavItemSlots {
  iconPostfix?: ReactNode;
  titlePrefix?: ReactNode;
}

export interface NavItemProps extends Omit<BlockProps, 'children' | 'title'> {
  actions?: ReactNode;
  active?: boolean;
  contextMenuItems?: GenericItemType[] | (() => GenericItemType[]);
  disabled?: boolean;
  extra?: ReactNode;
  /**
   * Optional href for cmd+click to open in new tab
   */
  href?: string;
  icon?: IconProps['icon'];
  loading?: boolean;
  slots?: NavItemSlots;
  title: ReactNode;
}

const NavItem = memo<NavItemProps>(
  ({
    className,
    actions,
    contextMenuItems,
    active,
    href,
    icon,
    title,
    onClick,
    disabled,
    loading,
    extra,
    slots,
    ...rest
  }) => {
    const iconColor = active ? cssVar.colorText : cssVar.colorTextDescription;
    const textColor = active ? cssVar.colorText : cssVar.colorTextSecondary;
    const variant = active ? 'filled' : 'borderless';

    const { titlePrefix, iconPostfix } = slots || {};
    // Link props for cmd+click support
    const linkProps = href
      ? {
          as: 'a' as const,
          href,
          style: { color: 'inherit', textDecoration: 'none' },
        }
      : {};

    const Content = (
      <Block
        horizontal
        align={'center'}
        className={cx(styles.container, className)}
        clickable={!disabled}
        gap={8}
        height={36}
        paddingInline={4}
        variant={variant}
        onClick={(e) => {
          if (disabled || loading) return;
          // Prevent default link behavior for normal clicks (let onClick handle it)
          // But allow cmd+click to open in new tab
          if (href && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
          }
          onClick?.(e);
        }}
        {...linkProps}
        {...rest}
      >
        {icon && (
          <Center flex={'none'} height={28} width={28}>
            {loading ? (
              <NeuralNetworkLoading size={18} />
            ) : (
              <Icon color={iconColor} icon={icon} size={18} />
            )}
          </Center>
        )}

        {iconPostfix}
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ overflow: 'hidden' }}>
          {titlePrefix}
          <Text
            color={textColor}
            style={{ flex: 1 }}
            ellipsis={{
              tooltipWhenOverflow: true,
            }}
          >
            {title}
          </Text>
          <Flexbox
            horizontal
            align={'center'}
            gap={2}
            justify={'flex-end'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {extra}
            {actions && (
              <Flexbox
                horizontal
                align={'center'}
                className={ACTION_CLASS_NAME}
                gap={2}
                justify={'flex-end'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                {actions}
              </Flexbox>
            )}
          </Flexbox>
        </Flexbox>
      </Block>
    );
    if (!contextMenuItems) return Content;
    return <ContextMenuTrigger items={contextMenuItems}>{Content}</ContextMenuTrigger>;
  },
);

export default NavItem;
