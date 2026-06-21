'use client';

import { useCallback } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
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
  const navigate = useWorkspaceAwareNavigate();

  const switchToTabByIndex = useCallback(
    (index: number) => {
      const { tabs, activateTab } = useElectronStore.getState();
      if (index < 0 || index >= tabs.length) return;

      const target = tabs[index];
      activateTab(target.id);
      navigate(target.url);
    },
    [navigate],
  );

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
      const { tabs, activeTabId, activateTab } = useElectronStore.getState();
      if (tabs.length === 0) return;

      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const nextIndex = (currentIndex + 1) % tabs.length;
      const target = tabs[nextIndex];

      activateTab(target.id);
      navigate(target.url);
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
      const { tabs, activeTabId, activateTab } = useElectronStore.getState();
      if (tabs.length === 0) return;

      const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
      const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      const target = tabs[prevIndex];

      activateTab(target.id);
      navigate(target.url);
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  );
};
