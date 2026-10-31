'use client';

import { type BlockProps, type DropdownItem, type IconProps } from '@lobehub/ui';
import { Block, Center, ContextMenuTrigger, cssVar, Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { memo } from 'react';

import { sx } from '@/styles/sx';
import { isModifierClick } from '@/utils/navigation';

import { type LazyActions, useLazyActions } from './useLazyActions';

const HOVER = ':is([data-nav-item]:hover *)';
const ACTION_FOCUS = ':is([data-nav-item]:has([data-nav-item-actions] :focus-visible) *)';
const POPUP_OPEN = ':is([data-nav-item]:has([data-popup-open]) *)';

const styles = stylex.create({
  container: {
    '--nav-item-actions-inset': {
      'default': '28px',
      ':has([data-nav-item-actions] > :nth-child(2 of :not([data-base-ui-focus-guard], [aria-owns])))':
        '54px',
    },
    'userSelect': 'none',
    'overflow': 'hidden',
    'minWidth': '32px',
  },
  actions: {
    pointerEvents: {
      default: 'none',
      [HOVER]: 'auto',
      [ACTION_FOCUS]: 'auto',
      [POPUP_OPEN]: 'auto',
    },
    opacity: { default: 0, [HOVER]: 1, [ACTION_FOCUS]: 1, [POPUP_OPEN]: 1 },
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: 0,
    paddingInlineEnd: '6px',
  },
  content: {
    maskImage: {
      default: null,
      [HOVER]:
        'linear-gradient(to right, #000 calc(100% - var(--nav-item-actions-inset) - 28px), transparent calc(100% - var(--nav-item-actions-inset)))',
      [ACTION_FOCUS]:
        'linear-gradient(to right, #000 calc(100% - var(--nav-item-actions-inset) - 28px), transparent calc(100% - var(--nav-item-actions-inset)))',
      [POPUP_OPEN]:
        'linear-gradient(to right, #000 calc(100% - var(--nav-item-actions-inset) - 28px), transparent calc(100% - var(--nav-item-actions-inset)))',
    },
  },
});

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
  contextMenuItems?: DropdownItem[] | (() => DropdownItem[]);
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
  xstyle?: StyleXStyles;
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
    xstyle,
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
        data-nav-item
        horizontal
        align={'center'}
        {...sx([styles.container, xstyle], className, mergedStyle)}
        clickable={!disabled}
        gap={8}
        height={description ? undefined : 36}
        paddingBlock={description ? 8 : undefined}
        paddingInline={4}
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
              <Spin size={iconSize} variant="network" />
            ) : (
              <Icon color={iconColor} icon={icon} size={iconSize} />
            )}
          </Center>
        )}

        {iconPostfix}
        <Flexbox
          horizontal
          align={'center'}
          {...sx([styles.content], undefined, { overflow: 'hidden' })}
          flex={1}
          gap={8}
        >
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
          {extra && (
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
            </Flexbox>
          )}
        </Flexbox>
        {actions && (
          <Flexbox
            data-nav-item-actions
            horizontal
            align={'center'}
            {...stylex.props(styles.actions)}
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
      </Block>
    );
    if (!contextMenuItems) return Content;
    return <ContextMenuTrigger items={contextMenuItems}>{Content}</ContextMenuTrigger>;
  },
);

NavItem.displayName = 'NavItem';

export default NavItem;
