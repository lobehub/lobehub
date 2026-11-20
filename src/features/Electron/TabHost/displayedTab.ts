import { create } from 'zustand';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { useElectronStore } from '@/store/electron';

interface DisplayedTabState {
  tabId: string | null;
}

// `activeTabId` flips as soon as a tab is clicked, but TabHost reveals the pane
// later (deferred, or held until a cold router loads). Chrome that must match
// the pane on screen, like the nav panel, follows this id instead.
export const useDisplayedTabStore = create<DisplayedTabState>(() => ({ tabId: null }));

export const useDisplayedTabUrl = (): string | null => {
  const tabId = useDisplayedTabStore((s) => s.tabId);

  return useElectronStore(
    (s) => (tabId && s.tabs.find((tab) => tab.id === tabId)?.url) || selectActiveTabUrl(s),
  );
};
