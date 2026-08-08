'use client';

import { type BlockProps, type GenericItemType, type IconProps } from '@lobehub/ui';
import { Block, Center, ContextMenuTrigger, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { memo } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { isModifierClick } from '@/utils/navigation';

import { type LazyActions, useLazyActions } from './useLazyActions';

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

      &:has([data-popup-open]),
      &:focus-within {
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
  /**
   * Pass a thunk to defer mounting until the row is first pointed at or focused.
   * Actions are invisible until `:hover` anyway, and an overlay-bearing action (a
   * dropdown, a popover) costs a dozen fibers per row — enough to matter in a
   * list. Focus counts as well as the pointer: a keyboard user tabs to the row
   * and must still find the actions in the tab order. Once mounted it stays
   * mounted, so an open popup survives the pointer leaving the row.
   */
  actions?: LazyActions;
  active?: boolean;
  contextMenuItems?: GenericItemType[] | (() => GenericItemType[]);
  /**
   * Optional second line rendered under the title (e.g. a topic's project
   * directory). When set, the row grows to fit both lines; when omitted the
   * layout is byte-identical to a single-line row.
   */
  description?: ReactNode;
  disabled?: boolean;
  extra?: ReactNode;
  /**
   * Optional href for cmd+click to open in new tab
   */
  href?: string;
  icon?: IconProps['icon'];
  iconSize?: number;
  loading?: boolean;
  slots?: NavItemSlots;
  title: ReactNode;
  /**
   * Override the title text color. Defaults to colorText when active and
   * colorTextSecondary otherwise. Pass cssVar.colorText to keep a row's title
   * fully emphasized regardless of active state (e.g. topic titles).
   */
  titleColor?: string;
}

const NavItem = memo<NavItemProps>(
  ({
    className,
    actions,
    contextMenuItems,
    active,
    href,
    icon,
    iconSize = 18,
    title,
    titleColor,
    description,
    onClick,
    disabled,
    loading,
    extra,
    slots,
    style,
    onFocus,
    onPointerEnter,
    ...rest
  }) => {
    const { mount: mountLazyActions, node: renderedActions } = useLazyActions(actions);

    const handlePointerEnter = (e: PointerEvent<HTMLDivElement>) => {
      mountLazyActions();
      onPointerEnter?.(e);
    };

    // Focus, not just the pointer: a keyboard user reaches the row by tabbing,
    // which never fires `pointerenter`. Without this the actions would be absent
    // from the tab order entirely rather than merely invisible.
    const handleFocus = (e: FocusEvent<HTMLDivElement>) => {
      mountLazyActions();
      onFocus?.(e);
    };

    const iconColor = active ? cssVar.colorText : cssVar.colorTextDescription;
    const textColor = titleColor ?? (active ? cssVar.colorText : cssVar.colorTextSecondary);
    const variant = active ? 'filled' : 'borderless';

    const { titlePrefix, iconPostfix } = slots || {};
    // Link props for cmd+click support
    const linkProps = href
      ? {
          as: 'a' as const,
          href,
        }
      : {};

    const mergedStyle =
      href || disabled || style
        ? {
            ...(href ? { color: 'inherit', textDecoration: 'none' } : undefined),
            // `disabled` only blocks the click by itself — dim the row so the
            // blocked state is visible instead of a silently dead button.
            ...(disabled ? { cursor: 'not-allowed', opacity: 0.5 } : undefined),
            ...style,
          }
        : undefined;

    const Content = (
      <Block
        horizontal
        align={'center'}
        className={cx(styles.container, className)}
        clickable={!disabled}
        gap={8}
        height={description ? undefined : 36}
        paddingBlock={description ? 8 : undefined}
        paddingInline={4}
        style={mergedStyle}
        variant={variant}
        onClick={(e) => {
          // Always prevent default <a> navigation for normal clicks to avoid full page reload.
          // This must run before any early return to ensure SPA navigation is never bypassed.
          if (href && !isModifierClick(e)) {
            e.preventDefault();
          }
          if (disabled) return;
          onClick?.(e);
        }}
        {...linkProps}
        {...rest}
        onFocus={handleFocus}
        onPointerEnter={handlePointerEnter}
      >
        {icon && (
          <Center
            flex={'none'}
            // With a description the row is two lines tall; align the leading icon
            // to the title's first line (match its line-height) instead of letting
            // it center across both lines, which drops it into the gap.
            height={description ? 22 : 28}
            style={description ? { alignSelf: 'flex-start' } : undefined}
            width={28}
          >
            {loading ? (
              <NeuralNetworkLoading size={iconSize} />
            ) : (
              <Icon color={iconColor} icon={icon} size={iconSize} />
            )}
          </Center>
        )}

        {iconPostfix}
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ overflow: 'hidden' }}>
          {titlePrefix}
          {description ? (
            <Flexbox flex={1} gap={3} style={{ overflow: 'hidden' }}>
              <Text color={textColor} ellipsis={{ tooltipWhenOverflow: true }}>
                {title}
              </Text>
              {description}
            </Flexbox>
          ) : (
            <Text
              color={textColor}
              style={{ flex: 1 }}
              ellipsis={{
                tooltipWhenOverflow: true,
              }}
            >
              {title}
            </Text>
          )}
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
                {renderedActions}
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

NavItem.displayName = 'NavItem';

export default NavItem;
