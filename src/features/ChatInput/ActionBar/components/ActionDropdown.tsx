'use client';

import {
  type DropdownMenuPopupProps,
  type DropdownMenuProps,
  type MenuItemType,
  type MenuProps,
  type PopoverTrigger,
} from '@lobehub/ui';
import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  renderDropdownMenuItems,
} from '@lobehub/ui';
import { createGlobalStyle, createStaticStyles, cssVar, cx } from 'antd-style';
import { type CSSProperties, type ReactNode } from 'react';
import {
  isValidElement,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import DebugNode from '@/components/DebugNode';
import { useIsMobile } from '@/hooks/useIsMobile';

const styles = createStaticStyles(({ css }) => ({
  dropdownMenu: css`
    .ant-avatar {
      margin-inline-end: var(--ant-margin-xs);
    }
  `,
  trigger: css`
    outline: none;
  `,
}));

const SubmenuScrollStyle = createGlobalStyle`
  /* base-ui DropdownMenu.Item reserves an indicator slot (empty aria-hidden
     span) for checkbox/radio variants. Our menu items don't use it, so the
     empty slot only contributes left whitespace. Collapse it across both
     the top-level menu and any nested submenu popups. */
  [role='menu'] [role='menuitem'] > * > span[aria-hidden='true']:empty,
  [role='menu'] [role='menuitem'] > span[aria-hidden='true']:empty {
    display: none;
  }

  [data-submenu] > [role='menu'] {
    will-change: auto;

    /* Submenus have 0ms animation, so disabling compositing is safe.
       Both will-change:transform AND the inherited transform: scaleY(1) from
       Menu.Positioner ('& > *' rule) create a new containing block, which
       breaks position:sticky for descendants and lets items leak below the
       popup. Disable both for submenus where animation is already 0ms. */
    transform: none !important;

    overflow: hidden auto;
    overscroll-behavior: contain;

    width: 360px;
    max-height: min(50vh, 640px);
    padding-block-end: 4px;
  }

  /* base-ui menu-item internal containers are flex by default but don't set
     min-width:0, which blocks descendant text-overflow:ellipsis from working.
     Force min-width:0 down the chain so long titles can truncate. */
  [data-submenu] > [role='menu'] [role='menuitem'] > *,
  [data-submenu] > [role='menu'] [role='menuitem'] > * > * {
    min-width: 0;
  }

  /* Align base-ui separator color with the stats-footer's border-block-start
     (colorBorderSecondary) so all dividers in the menu look consistent. */
  [data-submenu] > [role='menu'] [role='separator'] {
    background: ${cssVar.colorBorderSecondary};
  }

  /* base-ui group label is rendered inside a [role='presentation'] with its
     own default vertical padding, which stacks with our activationGroupHeader
     padding and inflates the gap above/below group headers. Reset only the
     vertical padding for skill activation groups; other groups (e.g. the
     Knowledge submenu's Libraries/Files headers) keep their default padding. */
  [data-submenu] > [role='menu'] [role='group']:has([data-skill-activation-group]) > [role='presentation'] {
    padding-block: 0;
  }

  [data-submenu] > [role='menu']:has([role='menuitem']:has([data-fixed-menu-footer])) {
    padding-block-end: 0 !important;
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer]) {
    position: sticky;
    z-index: 2;
    inset-block-end: 0;

    min-height: 0;
    padding-block: 8px 12px !important;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 0;

    background: ${cssVar.colorBgElevated};
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer]) > * {
    display: flex;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 4px;
    border-radius: ${cssVar.borderRadiusSM};
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-skill-stats]) {
    cursor: default;
    padding-block: 0 !important;
  }

  [data-submenu] > [role='menu'] [role='group']:has([data-skill-menu-search]) > *:has([data-skill-menu-search]) {
    padding-block: 6px 4px !important;
    padding-inline: 8px !important;
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer]):hover,
  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer])[data-highlighted] {
    background: ${cssVar.colorBgElevated};
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer]):hover > *,
  [data-submenu] > [role='menu'] [role='menuitem']:has([data-fixed-menu-footer])[data-highlighted] > * {
    background: ${cssVar.colorFillTertiary};
  }

  [data-submenu] > [role='menu'] [role='menuitem']:has([data-skill-stats]):hover > *,
  [data-submenu] > [role='menu'] [role='menuitem']:has([data-skill-stats])[data-highlighted] > * {
    background: transparent;
  }
`;

export type ActionDropdownMenuItem = MenuItemType;

export type ActionDropdownMenuItems = MenuProps<ActionDropdownMenuItem>['items'];

type ActionDropdownMenu = Omit<
  Pick<MenuProps<ActionDropdownMenuItem>, 'className' | 'onClick' | 'style'>,
  'items'
> & {
  items: ActionDropdownMenuItems | (() => ActionDropdownMenuItems);
};

export interface ActionDropdownProps extends Omit<DropdownMenuProps, 'items'> {
  maxHeight?: number | string;
  maxWidth?: number | string;
  menu: ActionDropdownMenu;
  minHeight?: number | string;
  minWidth?: number | string;
  popupRender?: (menu: ReactNode) => ReactNode;
  /**
   * Whether to pre-render the dropdown overlay on mount, to avoid rendering lag on first expand
   */
  prefetch?: boolean;
  trigger?: PopoverTrigger;
}

const ActionDropdown = memo<ActionDropdownProps>(
  ({
    children,
    defaultOpen,
    menu,
    trigger,
    maxHeight,
    maxWidth,
    minHeight,
    minWidth,
    onOpenChange,
    onOpenChangeComplete,
    open,
    placement = 'top',
    popupProps,
    popupRender,
    portalProps,
    positionerProps,
    prefetch,

    triggerProps,
    ...rest
  }) => {
    const isMobile = useIsMobile();
    const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
    const menuItemsRef = useRef<ReactNode[] | null>(null);

    useEffect(() => {
      if (open === undefined) return;
      setUncontrolledOpen(open);
    }, [open]);

    const handleOpenChange = useCallback(
      (nextOpen: boolean, details: Parameters<NonNullable<typeof onOpenChange>>[1]) => {
        if (!nextOpen && (details as { reason?: string })?.reason === 'sibling-open') {
          (details as { cancel?: () => void })?.cancel?.();
          return;
        }
        onOpenChange?.(nextOpen, details);
        if (open === undefined) setUncontrolledOpen(nextOpen);
      },
      [onOpenChange, open],
    );

    const handleOpenChangeComplete = useCallback(
      (nextOpen: boolean) => {
        onOpenChangeComplete?.(nextOpen);
        if (!nextOpen) menuItemsRef.current = null;
      },
      [onOpenChangeComplete],
    );

    const isOpen = open ?? uncontrolledOpen;
    const openOnHover = useMemo(() => {
      if (!trigger) return undefined;
      if (trigger === 'both') return true;
      if (Array.isArray(trigger)) return trigger.includes('hover');
      return trigger === 'hover';
    }, [trigger]);
    const resolvedTriggerProps = useMemo(() => {
      if (openOnHover === undefined) return { nativeButton: false, ...triggerProps };
      return {
        nativeButton: false,
        ...triggerProps,
        openOnHover,
      };
    }, [openOnHover, triggerProps]);

    const decorateMenuItems = useCallback(
      (items: ActionDropdownMenuItems): ActionDropdownMenuItems => {
        if (!items) return items;

        return items.map((item) => {
          if (!item) return item;
          if ('type' in item && item.type === 'divider') return item;
          if ('type' in item && item.type === 'group') {
            return {
              ...item,
              children: item.children ? decorateMenuItems(item.children) : item.children,
            };
          }

          if ('children' in item && item.children) {
            const originalOnOpenChange = (item as { onOpenChange?: unknown }).onOpenChange as
              | ((open: boolean, details: unknown) => void)
              | undefined;
            return {
              ...item,
              children: decorateMenuItems(item.children),
              type: 'submenu',
            };
          }
          const itemOnClick = 'onClick' in item ? item.onClick : undefined;
          const closeOnClick = 'closeOnClick' in item ? item.closeOnClick : undefined;
          const keepOpenOnClick = closeOnClick === false;
          const itemLabel = 'label' in item ? item.label : undefined;
          const shouldKeepOpen = isValidElement(itemLabel);

          const resolvedCloseOnClick = closeOnClick ?? (shouldKeepOpen ? false : undefined);

          return {
            ...item,
            ...(resolvedCloseOnClick !== undefined ? { closeOnClick: resolvedCloseOnClick } : null),
            onClick: (info) => {
              if (keepOpenOnClick) {
                info.domEvent.stopPropagation();
                menu.onClick?.(info);
                itemOnClick?.(info);
                return;
              }

              info.domEvent.preventDefault();
              menu.onClick?.(info);
              itemOnClick?.(info);
            },
          };
        });
      },
      [menu],
    );

    const renderedItems = useMemo(() => {
      if (!prefetch && !isOpen) return menuItemsRef.current;
      const sourceItems = typeof menu.items === 'function' ? menu.items() : menu.items;
      const nextItems = renderDropdownMenuItems(decorateMenuItems(sourceItems ?? []));

      menuItemsRef.current = nextItems;

      return nextItems;
    }, [decorateMenuItems, isOpen, menu, prefetch]);

    const menuContent = useMemo(() => {
      if (!popupRender) return renderedItems;

      return popupRender(renderedItems ?? null);
    }, [popupRender, renderedItems]);

    const resolvedPopupClassName = useMemo<DropdownMenuPopupProps['className']>(() => {
      const popupClassName = popupProps?.className;
      if (typeof popupClassName === 'function') {
        return (state) => cx(styles.dropdownMenu, menu.className, popupClassName(state));
      }
      return cx(styles.dropdownMenu, menu.className, popupClassName);
    }, [menu.className, popupProps?.className]);

    const resolvedPopupStyle = useMemo<DropdownMenuPopupProps['style']>(() => {
      const baseStyle: CSSProperties = {
        maxHeight,
        maxWidth: isMobile ? undefined : maxWidth,
        minHeight,
        minWidth: isMobile ? undefined : minWidth,
        overflowX: 'hidden',
        overflowY: 'scroll',
        width: isMobile ? '100vw' : undefined,
      };
      const popupStyle = popupProps?.style;

      if (typeof popupStyle === 'function') {
        return (state) => ({
          ...baseStyle,
          ...menu.style,
          ...popupStyle(state),
        });
      }

      return {
        ...baseStyle,
        ...menu.style,
        ...popupStyle,
      };
    }, [isMobile, maxHeight, maxWidth, menu.style, minHeight, minWidth, popupProps?.style]);

    const resolvedPopupProps = useMemo(() => {
      if (!popupProps) {
        return {
          className: resolvedPopupClassName,
          style: resolvedPopupStyle,
        };
      }

      return {
        ...popupProps,
        className: resolvedPopupClassName,
        style: resolvedPopupStyle,
      };
    }, [popupProps, resolvedPopupClassName, resolvedPopupStyle]);

    const { container: portalContainer, ...restPortalProps } = portalProps ?? {};
    const resolvedPortalContainer = useMemo<HTMLElement | null | undefined>(() => {
      if (!portalContainer) return portalContainer ?? undefined;
      if (typeof portalContainer === 'object' && 'current' in portalContainer) {
        const current = portalContainer.current;
        if (!current) return null;
        if (typeof ShadowRoot !== 'undefined' && current instanceof ShadowRoot) {
          return current.host as HTMLElement;
        }
        return current as HTMLElement;
      }
      if (typeof ShadowRoot !== 'undefined' && portalContainer instanceof ShadowRoot) {
        return portalContainer.host as HTMLElement;
      }
      return portalContainer as HTMLElement;
    }, [portalContainer]);

    return (
      <>
        <SubmenuScrollStyle />
        <DropdownMenuRoot
          {...rest}
          defaultOpen={defaultOpen}
          open={open}
          onOpenChange={handleOpenChange}
          onOpenChangeComplete={handleOpenChangeComplete}
        >
          <DropdownMenuTrigger className={styles.trigger} {...resolvedTriggerProps}>
            {children}
          </DropdownMenuTrigger>
          <DropdownMenuPortal container={resolvedPortalContainer} {...restPortalProps}>
            <DropdownMenuPositioner
              {...positionerProps}
              hoverTrigger={Boolean(resolvedTriggerProps?.openOnHover)}
              placement={isMobile ? 'top' : placement}
            >
              <DropdownMenuPopup {...resolvedPopupProps}>
                <Suspense fallback={<DebugNode trace="ActionDropdown > popup" />}>
                  {menuContent}
                </Suspense>
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </>
    );
  },
);

export default ActionDropdown;
