import type { NativeContextMenuItem, ShowContextMenuOptions } from './types';

const isNativeSafe = (item: NativeContextMenuItem): boolean => {
  if (item === null) return true;
  if (item.type === 'switch') return false;

  if ('extra' in item && item.extra) return false;
  if ('loading' in item && item.loading) return false;

  if ('label' in item) {
    const { label } = item;
    if (label !== undefined && typeof label !== 'string' && typeof label !== 'number') return false;
  }

  if ('desc' in item) {
    const { desc } = item;
    if (desc !== undefined && typeof desc !== 'string') return false;
  }

  if ('children' in item && item.children) {
    return item.children.every(isNativeSafe);
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
