'use client';

import { DEFAULT_HOTKEY_CONFIG } from '@lobechat/const';
import { useHotkeys } from 'react-hotkeys-hook';

import { useElectronStore } from '@/store/electron';

/**
 * Ctrl+1–9: jump to the Nth tab.
 * Ctrl+Tab: cycle to the next tab, wrapping around.
 * Ctrl+Shift+Tab: cycle to the previous tab, wrapping around.
 *
 * Must be called from a component that only renders in the Desktop app
 * (e.g. TabBar) — no `isDesktop` guard needed.
 */
export const useRegisterDesktopTabHotkeys = () => {
  // The settings page displays a range; react-hotkeys-hook needs individual keys.
  useHotkeys(
    Array.from({ length: 9 }, (_, i) =>
      DEFAULT_HOTKEY_CONFIG.switchTab.replace('1-9', String(i + 1)),
    ),
    (e) => {
      // Use the physical number key, including keyboard layouts such as AZERTY.
      const digit = Number(e.code.replace(/^(Digit|Numpad)/, ''));
      const { tabs, switchTab } = useElectronStore.getState();
      const target = tabs[digit - 1];
      if (target) switchTab(target.id);
    },
    {
      enableOnContentEditable: true,
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

  // Ctrl+Tab: next tab (wrap around)
  useHotkeys(
    DEFAULT_HOTKEY_CONFIG.nextTab,
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
      enableOnContentEditable: true,
      enableOnFormTags: true,
      preventDefault: true,
    },
  );

  // Ctrl+Shift+Tab: previous tab (wrap around)
  useHotkeys(
    DEFAULT_HOTKEY_CONFIG.prevTab,
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
      enableOnContentEditable: true,
      enableOnFormTags: true,
      preventDefault: true,
    },
  );
};
