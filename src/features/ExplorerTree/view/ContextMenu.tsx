import { showContextMenu } from '@/libs/contextMenu';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

// Defers the user's onClick to the next frame so base-ui's focus restoration
// on close completes before the action runs. Without this, actions like
// inline-rename briefly take focus and then lose it back to whatever was
// active before the menu opened, which makes the rename input invisible.
const wrapItem = (item: NativeContextMenuItem): NativeContextMenuItem => {
  if (!item || typeof item !== 'object') return item;
  const next = { ...(item as unknown as Record<string, unknown>) };
  if ('children' in item && Array.isArray((item as { children?: unknown }).children)) {
    next.children = (item as { children: NativeContextMenuItem[] }).children.map((child) =>
      wrapItem(child),
    );
  }
  const original = (item as { onClick?: (...args: unknown[]) => void }).onClick;
  if (original) {
    next.onClick = (...args: unknown[]) => {
      requestAnimationFrame(() => original(...args));
    };
  }
  return next as unknown as NativeContextMenuItem;
};

export const openExplorerContextMenu = (items: NativeContextMenuItem[]) => {
  if (!items || items.length === 0) return;
  showContextMenu(items.map((item) => wrapItem(item)));
};
