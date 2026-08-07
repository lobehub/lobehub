import type { NativeContextMenuItem, ShowContextMenuOptions } from './types';

export const isSubmenuShaped = (item: Exclude<NativeContextMenuItem, null>): boolean =>
  item.type !== 'group' &&
  (item.type === 'submenu' || Boolean('children' in item && item.children));

const isNativeSafe = (item: NativeContextMenuItem): boolean => {
  if (item === null) return true;
  if (item.type === 'switch') return false;

  if ('extra' in item && item.extra) return false;
  if ('loading' in item && item.loading) return false;
  if ('closeOnClick' in item && item.closeOnClick === false) return false;

  if ('label' in item) {
    const { label } = item;
    if (label !== undefined && typeof label !== 'string' && typeof label !== 'number') return false;
  }

  if ('desc' in item) {
    const { desc } = item;
    if (desc !== undefined && typeof desc !== 'string') return false;
  }

  const children = 'children' in item ? item.children : undefined;

  if (isSubmenuShaped(item)) {
    if ('header' in item && item.header) return false;
    if ('footer' in item && item.footer) return false;
    if (!children || children.length === 0) return false;
  }

  if (children) {
    return children.every(isNativeSafe);
  }

  return true;
};

export const canGoNative = (
  items: NativeContextMenuItem[],
  options?: ShowContextMenuOptions,
): boolean => {
  if (options?.header || options?.footer) return false;
  return items.every(isNativeSafe);
};
