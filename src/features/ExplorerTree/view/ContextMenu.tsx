import { Menu, type MenuProps } from 'antd';
import { memo, type ReactNode, useMemo } from 'react';

interface ContextMenuSurfaceProps {
  items: MenuProps['items'];
  onClose: () => void;
}

const ContextMenuSurface = memo<ContextMenuSurfaceProps>(({ items, onClose }) => {
  const patched = useMemo<MenuProps['items']>(() => {
    if (!items) return items;
    const wrap = (list: NonNullable<MenuProps['items']>): NonNullable<MenuProps['items']> =>
      list.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const next = { ...item } as Record<string, unknown>;
        if ('children' in item && Array.isArray((item as { children?: unknown }).children)) {
          next.children = wrap((item as { children: NonNullable<MenuProps['items']> }).children);
        }
        const originalOnClick = (item as { onClick?: (...args: unknown[]) => void }).onClick;
        if (originalOnClick) {
          next.onClick = (...args: unknown[]) => {
            onClose();
            originalOnClick(...args);
          };
        }
        return next as unknown as NonNullable<MenuProps['items']>[number];
      });
    return wrap(items);
  }, [items, onClose]);

  return (
    <div
      data-file-tree-context-menu-root="true"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Menu
        items={patched}
        selectable={false}
        style={{ borderRadius: 6, boxShadow: 'var(--ant-box-shadow-secondary)', minWidth: 160 }}
      />
    </div>
  );
});

ContextMenuSurface.displayName = 'ExplorerTreeContextMenu';

export const renderContextMenuSurface = (
  items: MenuProps['items'],
  onClose: () => void,
): ReactNode => <ContextMenuSurface items={items} onClose={onClose} />;

export default ContextMenuSurface;
