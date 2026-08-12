import { type ElectronStore } from '@/store/electron';

export const selectActiveTabUrl = (s: ElectronStore): string | null =>
  s.tabs.find((tab) => tab.id === s.activeTabId)?.url ?? null;
