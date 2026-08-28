'use client';

import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { useElectronStore } from '@/store/electron';

/**
 * Mod+1–9: jump to the Nth tab.
 * Ctrl+Tab: cycle to the next tab, wrapping around.
 * Ctrl+Shift+Tab: cycle to the previous tab, wrapping around.
 *
 * Must be called from a component that only renders in the Desktop app
 * (e.g. TabBar) — no `isDesktop` guard needed.
 */
export const useRegisterDesktopTabHotkeys = () => {
  const switchToTabByIndex = useCallback((index: number) => {
    const { tabs, switchTab } = useElectronStore.getState();
    if (index < 0 || index >= tabs.length) return;

    const target = tabs[index];
    switchTab(target.id);
  }, []);

  // Mod+1 through Mod+9
  useHotkeys(
    'mod+1,mod+2,mod+3,mod+4,mod+5,mod+6,mod+7,mod+8,mod+9',
    (e) => {
      e.preventDefault();
      const digit = Number(e.key);
      if (digit >= 1 && digit <= 9) {
        switchToTabByIndex(digit - 1);
      }
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

  // Ctrl+Tab: next tab (wrap around)
  useHotkeys(
    'ctrl+tab',
    (e) => {
      e.preventDefault();
      const { tabs, activeTabId, switchTab } = useElectronStore.getState();
      if (tabs.length === 0) return;

      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % tabs.length;
      const target = tabs[nextIndex];

      switchTab(target.id);
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

  // Ctrl+Shift+Tab: previous tab (wrap around)
  useHotkeys(
    'ctrl+shift+tab',
    (e) => {
      e.preventDefault();
      const { tabs, activeTabId, switchTab } = useElectronStore.getState();
      if (tabs.length === 0) return;

      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      const target = tabs[prevIndex];

      switchTab(target.id);
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );
};
