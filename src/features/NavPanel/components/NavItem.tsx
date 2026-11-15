'use client';

import { type BlockProps, type DropdownItem, type IconProps } from '@lobehub/ui';
import {
  Block,
  Center,
  ContextMenuTrigger,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  Spin,
  Text,
} from '@lobehub/ui';
import { type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { memo } from 'react';

import { isModifierClick } from '@/utils/navigation';

import { type LazyActions, useLazyActions } from './useLazyActions';
import {
  NAV_ITEM_ACTIONS_INSET_VAR,
  NAV_ITEM_CONTENT_FADE,
  TITLE_MARQUEE_FADE,
  TITLE_MARQUEE_FADE_END_VAR,
  TITLE_MARQUEE_FADE_START_VAR,
  useTitleMarquee,
  useTitleMarqueeAvailable,
} from './useTitleMarquee';

const ACTION_CLASS_NAME = 'nav-item-actions';
const CONTENT_CLASS_NAME = 'nav-item-content';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    /* Width the title fades out under: one small action icon (24px) plus spacing.
       Each extra icon adds its 24px plus the 2px gap. The focus guards and the
       aria-owns portal marker an open menu inserts beside its trigger are not
       icons, so they are not counted. */
    ${NAV_ITEM_ACTIONS_INSET_VAR}: 28px;

    user-select: none;
    overflow: hidden;
    min-width: 32px;

    &:has(.${ACTION_CLASS_NAME} > :nth-child(2 of :not([data-base-ui-focus-guard], [aria-owns]))) {
      ${NAV_ITEM_ACTIONS_INSET_VAR}: 54px;
    }

    /* focus-visible, not focus-within: closing a dropdown hands focus back to its
       trigger, which would pin the actions open after the pointer has left. */
    &:hover,
    &:has(.${ACTION_CLASS_NAME} :focus-visible),
    &:has([data-popup-open]) {
      .${ACTION_CLASS_NAME} {
        pointer-events: auto;
        opacity: 1;
      }

      /* Fade the covered text itself instead of painting a row-colored plate over it,
         so the overlay matches any row background (hover / active / none). */
      .${CONTENT_CLASS_NAME} {
        mask-image: linear-gradient(
          to right,
          black calc(100% - var(${NAV_ITEM_ACTIONS_INSET_VAR}) - ${NAV_ITEM_CONTENT_FADE}px),
          transparent calc(100% - var(${NAV_ITEM_ACTIONS_INSET_VAR}))
        );
      }
    }

    /* Overlay instead of in-flow so revealing the actions never re-truncates the title. */
    .${ACTION_CLASS_NAME} {
      pointer-events: none;

      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;

      padding-inline-end: 6px;

      opacity: 0;
    }
  `,
  marqueeText: css`
    display: block;
    width: max-content;
  `,
  /* Clipped titles fade out at the right edge instead of ending in an ellipsis,
     which spends ~3ch of row width on punctuation. The box is as wide as the
     row, so a title that fits never reaches the fade. While hovered, the
     marquee animates both edge widths (see useTitleMarquee). */
  marqueeViewport: css`
    ${TITLE_MARQUEE_FADE_END_VAR}: ${TITLE_MARQUEE_FADE}px;

    overflow: hidden;
    display: block;
    white-space: nowrap;

    mask-image: linear-gradient(
      to right,
      transparent,
      #000 var(${TITLE_MARQUEE_FADE_START_VAR}, 0px),
      #000 calc(100% - var(${TITLE_MARQUEE_FADE_END_VAR})),
      transparent
    );
  `,
}));

export interface NavItemSlots {
  /** Stacked under the leading icon, e.g. a short status label on a two-line row. */
  iconBelow?: ReactNode;
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
  /**
   * Denser single-line row for long lists of shortcuts (e.g. Favorites): 28px
   * tall with 13px text and a 16px icon, instead of 36px / 14px / 18px. The
   * icon column keeps its width, so titles still line up with the other rows.
   */
  compact?: boolean;
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
  /**
   * Reveal an overflowing title by sliding it to its tail while the row is
   * hovered, instead of showing it in a tooltip. Use for rows whose titles are
   * long free text (topic titles); at rest a clipped title fades out at its
   * right edge instead of ending in an ellipsis. Under reduced motion or an
   * RTL locale the row keeps the ellipsis and tooltip, since the slide and the
   * edge fades assume left-to-right text.
   */
  titleMarquee?: boolean;
}

const NavItem = memo<NavItemProps>(
  ({
    className,
    actions,
    contextMenuItems,
    active,
    compact,
    href,
    icon,
    iconSize = compact ? 16 : 18,
    title,
    titleColor,
    titleMarquee,
    description,
    onClick,
    disabled,
    loading,
    extra,
    slots,
    style,
    onFocus,
    onPointerEnter,
    onPointerLeave,
    ...rest
  }) => {
    const { mount: mountLazyActions, node: renderedActions } = useLazyActions(actions);
    const marqueeAvailable = useTitleMarqueeAvailable();
    const marquee = !!titleMarquee && marqueeAvailable;
    const {
      start: startTitleMarquee,
      stop: stopTitleMarquee,
      textRef: titleTextRef,
      viewportRef: titleViewportRef,
    } = useTitleMarquee(marquee, typeof title === 'string' ? title : undefined);

    const handlePointerEnter = (e: PointerEvent<HTMLDivElement>) => {
      mountLazyActions();
      startTitleMarquee();
      onPointerEnter?.(e);
    };

    const handlePointerLeave = (e: PointerEvent<HTMLDivElement>) => {
      stopTitleMarquee();
      onPointerLeave?.(e);
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

    const { titlePrefix, iconBelow, iconPostfix } = slots || {};
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

    const titleFontSize = compact ? 13 : undefined;
    // A description stacks the title in a column, where `flex: 1` would grow it vertically.
    const titleStyle = description ? undefined : { flex: 1 };
    const titleNode = marquee ? (
      <Text color={textColor} fontSize={titleFontSize} style={{ ...titleStyle, minWidth: 0 }}>
        <span className={styles.marqueeViewport} ref={titleViewportRef}>
          <span className={styles.marqueeText} ref={titleTextRef}>
            {title}
          </span>
        </span>
      </Text>
    ) : (
      <Text
        color={textColor}
        ellipsis={{ tooltipWhenOverflow: true }}
        fontSize={titleFontSize}
        style={titleStyle}
      >
        {title}
      </Text>
    );

    const iconNode = icon && (
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
    );

    const Content = (
      <Block
        horizontal
        align={'center'}
        className={cx(styles.container, className)}
        clickable={!disabled}
        data-nav-item=""
        gap={8}
        height={description ? undefined : compact ? 28 : 36}
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
        onPointerLeave={handlePointerLeave}
      >
        {iconNode && iconBelow ? (
          <Flexbox
            align={'center'}
            flex={'none'}
            gap={2}
            style={description ? { alignSelf: 'flex-start' } : undefined}
            // Keep the icon column width so the title does not shift; a wider
            // label overflows evenly into the gaps around it.
            width={28}
          >
            {iconNode}
            {iconBelow}
          </Flexbox>
        ) : (
          iconNode
        )}

        {iconPostfix}
        <Flexbox
          horizontal
          align={'center'}
          className={CONTENT_CLASS_NAME}
          data-nav-item-content=""
          flex={1}
          gap={8}
          style={{ overflow: 'hidden' }}
        >
          {titlePrefix}
          {description ? (
            <Flexbox flex={1} gap={3} style={{ overflow: 'hidden' }}>
              {titleNode}
              {description}
            </Flexbox>
          ) : (
            titleNode
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
      </Block>
    );
    if (!contextMenuItems) return Content;
    return <ContextMenuTrigger items={contextMenuItems}>{Content}</ContextMenuTrigger>;
  },
);

NavItem.displayName = 'NavItem';

export default NavItem;
