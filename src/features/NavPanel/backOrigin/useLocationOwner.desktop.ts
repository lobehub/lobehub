import { useElectronStore } from '@/store/electron';

import { MAIN_OWNER } from './useLocationOwner';

export { MAIN_OWNER };

/**
 * Which history a location belongs to: each Electron tab (or split pane) keeps
 * its own, so focusing another tab is not a navigation.
 */
export const useLocationOwner = (): string => useElectronStore((s) => s.activeTabId) ?? MAIN_OWNER;

/** The open tab ids joined by `\n`, so closing a tab can drop its back trail. */
export const useOpenOwnersKey = (): string | null =>
  useElectronStore((s) => s.tabs.map((tab) => tab.id).join('\n'));
