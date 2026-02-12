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
import { createStaticStyles, cx } from 'antd-style';
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
}));

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
   * 是否在挂载时预渲染弹层，避免首次触发展开时的渲染卡顿
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
            return {
              ...item,
              children: decorateMenuItems(item.children),
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
    }, [decorateMenuItems, isOpen, menu.items, prefetch]);

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
      <DropdownMenuRoot
        {...rest}
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <DropdownMenuTrigger {...resolvedTriggerProps}>{children}</DropdownMenuTrigger>
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
