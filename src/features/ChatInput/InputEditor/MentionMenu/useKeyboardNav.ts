import type { ISlashMenuOption } from '@lobehub/editor';
import { useEffect } from 'react';

interface KeyboardNavOptions {
  activeKey: string | null;
  mode: 'home' | 'category' | 'search';
  onBack: () => void;
  onSelect: (option: ISlashMenuOption) => void;
  open: boolean;
  setActiveKey: (key: string | null) => void;
  visibleItems: ISlashMenuOption[];
}

export const useKeyboardNav = ({
  open,
  visibleItems,
  activeKey,
  setActiveKey,
  onSelect,
  onBack,
  mode,
}: KeyboardNavOptions) => {
  useEffect(() => {
    if (!open || visibleItems.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();

        const idx = visibleItems.findIndex((i) => String(i.key) === activeKey);
        const next =
          e.key === 'ArrowDown'
            ? (idx + 1) % visibleItems.length
            : (idx - 1 + visibleItems.length) % visibleItems.length;

        const nextKey = String(visibleItems[next].key);
        setActiveKey(nextKey);

        // Scroll active item into view
        requestAnimationFrame(() => {
          document.getElementById(`mention-item-${nextKey}`)?.scrollIntoView({ block: 'nearest' });
        });
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = visibleItems.find((i) => String(i.key) === activeKey);
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onSelect(item);
        }
      }

      if (e.key === 'Escape' && mode === 'category') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onBack();
      }
      // Home/Search Escape: do NOT intercept → let editor close the menu
    };

    document.addEventListener('keydown', handler, true); // capture phase
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, visibleItems, activeKey, setActiveKey, onSelect, onBack, mode]);
};
