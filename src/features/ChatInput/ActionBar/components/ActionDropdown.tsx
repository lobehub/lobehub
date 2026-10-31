'use client';

import './ActionDropdown.global.css';

import {
  type BaseMenuItemType,
  type DropdownMenuPopupProps,
  type DropdownMenuProps,
  type MenuInfo,
  type MenuItemType,
  type PopoverTrigger,
} from '@lobehub/ui';
import {
  cx,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  renderDropdownMenuItems,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

import { type MenuOpenChangeDetails, shouldVetoMenuClose } from './menuCloseVeto';

const styles = stylex.create({
  trigger: {
    // Keyboard users still need a landmark for where Enter will land.
    outlineStyle: { 'default': 'none', ':focus-visible': 'solid' },
    borderRadius: { 'default': null, ':focus-visible': cssVar.borderRadius },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
});

export type ActionDropdownMenuItem = MenuItemType;

/**
 * `renderDropdownMenuItems` accepts Base UI's full item union (`BaseMenuItemType`),
 * which is wider than antd's `MenuProps['items']` — it also covers `type: 'switch'`
 * and `type: 'checkbox'` items. Use it here so callers can declare those directly.
 */
export type ActionDropdownMenuItems = BaseMenuItemType[];

interface MenuItemsHostProps {
  close: () => void;
  decorate: (items: ActionDropdownMenuItems) => ActionDropdownMenuItems;
  useItems: (ctx: { close: () => void }) => ActionDropdownMenuItems;
}

/**
 * Rendered inside the popup, which Base UI only mounts while the menu is open —
 * so `useItems` and everything it subscribes to stays off the trigger's mount path.
 */
const MenuItemsHost = memo<MenuItemsHostProps>(({ close, decorate, useItems }) => {
  const items = useItems({ close });

  return <>{renderDropdownMenuItems(decorate(items ?? []))}</>;
});

MenuItemsHost.displayName = 'ActionDropdownMenuItemsHost';

type ActionDropdownMenu = {
  className?: string;
  onClick?: (info: MenuInfo) => void;
  style?: CSSProperties;
  items?: ActionDropdownMenuItems | (() => ActionDropdownMenuItems);
  /**
   * Hook form of `items`, invoked from inside the popup so it only runs while the
   * menu is open. Use this when building the items needs hooks (store subscriptions,
   * SWR, local state) that would otherwise run on every mount of the trigger.
   */
  useItems?: (ctx: { close: () => void }) => ActionDropdownMenuItems;
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
        if (
          !nextOpen &&
          ((details as MenuOpenChangeDetails)?.reason === 'sibling-open' ||
            shouldVetoMenuClose(details as MenuOpenChangeDetails))
        ) {
          (details as MenuOpenChangeDetails)?.cancel?.();
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
      if (openOnHover === undefined) return { ...triggerProps };
      return {
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
          // Switch / checkbox items are self-contained: they toggle via `onCheckedChange`,
          // and Base UI already wires up "click the row or the control" for them. Pass them
          // through untouched instead of wrapping their click handler.
          if ('type' in item && (item.type === 'switch' || item.type === 'checkbox')) {
            return item;
          }

          // Any item carrying a `children` key is a submenu (children may be optional);
          // route them all here so plain items never inherit a submenu's click signature.
          if ('children' in item) {
            const itemOnOpenChange = (
              item as { onOpenChange?: (open: boolean, details?: MenuOpenChangeDetails) => void }
            ).onOpenChange;
            return {
              ...item,
              children: item.children ? decorateMenuItems(item.children) : item.children,
              onOpenChange: (open: boolean, details?: MenuOpenChangeDetails) => {
                if (!open && shouldVetoMenuClose(details)) {
                  details?.cancel?.();
                  return;
                }
                itemOnOpenChange?.(open, details);
              },
              type: 'submenu',
              // `children` is re-widened to the full item union; cast back to satisfy
              // the mixed rc-menu / Base UI submenu types in `BaseMenuItemType`.
            } as BaseMenuItemType;
          }
          // Submenus are handled above; everything else is a plain menu item. Base UI's
          // types keep optional-`children` submenu members in scope here, so narrow to the
          // plain-item type before wrapping the click handler.
          const menuItem = item as ActionDropdownMenuItem;
          const itemOnClick = menuItem.onClick;
          const closeOnClick = menuItem.closeOnClick;
          const keepOpenOnClick = closeOnClick === false;
          const itemLabel = menuItem.label;
          const shouldKeepOpen = isValidElement(itemLabel);

          const resolvedCloseOnClick = closeOnClick ?? (shouldKeepOpen ? false : undefined);

          return {
            ...menuItem,
            ...(resolvedCloseOnClick !== undefined ? { closeOnClick: resolvedCloseOnClick } : null),
            onClick: (info: MenuInfo) => {
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

    const closePopup = useCallback(() => {
      onOpenChange?.(false, { reason: 'item-press' } as never);
      if (open === undefined) setUncontrolledOpen(false);
    }, [onOpenChange, open]);

    const renderedItems = useMemo(() => {
      if (menu.useItems) return null;
      if (!prefetch && !isOpen) return menuItemsRef.current;
      const sourceItems = typeof menu.items === 'function' ? menu.items() : menu.items;
      const nextItems = renderDropdownMenuItems(decorateMenuItems(sourceItems ?? []));

      menuItemsRef.current = nextItems;

      return nextItems;
    }, [decorateMenuItems, isOpen, menu, prefetch]);

    const menuContent = useMemo(() => {
      const body = menu.useItems ? (
        <MenuItemsHost close={closePopup} decorate={decorateMenuItems} useItems={menu.useItems} />
      ) : (
        renderedItems
      );

      if (!popupRender) return body;

      return popupRender(body ?? null);
    }, [closePopup, decorateMenuItems, menu.useItems, popupRender, renderedItems]);

    const resolvedPopupClassName = useMemo<DropdownMenuPopupProps['className']>(() => {
      const popupClassName = popupProps?.className;
      if (typeof popupClassName === 'function') {
        return (state) => cx(menu.className, popupClassName(state));
      }
      return cx(menu.className, popupClassName);
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
      <DropdownMenuRoot
        {...rest}
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <DropdownMenuTrigger
          className={stylex.props(styles.trigger).className}
          {...resolvedTriggerProps}
        >
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
    );
  },
);

export default ActionDropdown;
