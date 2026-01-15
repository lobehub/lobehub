'use client';

import {
  Block,
  type BlockProps,
  Center,
  ContextMenuTrigger,
  Flexbox,
  type GenericItemType,
  Icon,
  type IconProps,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type ReactNode, memo } from 'react';

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
    ...rest
  }) => {
    const iconColor = active ? cssVar.colorText : cssVar.colorTextDescription;
    const textColor = active ? cssVar.colorText : cssVar.colorTextSecondary;
    const variant = active ? 'filled' : 'borderless';

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
        align={'center'}
        className={cx(styles.container, className)}
        clickable={!disabled}
        gap={8}
        height={36}
        horizontal
        onClick={(e) => {
          if (disabled || loading) return;
          // Prevent default link behavior for normal clicks (let onClick handle it)
          // But allow cmd+click to open in new tab
          if (href && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
          }
          onClick?.(e);
        }}
        paddingInline={4}
        variant={variant}
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

        <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ overflow: 'hidden' }}>
          <Text color={textColor} ellipsis style={{ flex: 1 }}>
            {title}
          </Text>
          <Flexbox
            align={'center'}
            gap={2}
            horizontal
            justify={'flex-end'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {extra}
            {actions && (
              <Flexbox
                align={'center'}
                className={ACTION_CLASS_NAME}
                gap={2}
                horizontal
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
