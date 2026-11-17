import { tabScopeKey } from '@/features/Electron/titlebar/TabBar/scope';
import { useElectronStore } from '@/store/electron';

import { MAIN_OWNER } from './locationOwner';

export { MAIN_OWNER, type OpenOwners, parseOpenOwners } from './locationOwner';

/**
 * Which history a location belongs to: each Electron tab (or split pane) keeps
 * its own, so focusing another tab is not a navigation.
 */
export const useLocationOwner = (): string => useElectronStore((s) => s.activeTabId) ?? MAIN_OWNER;

/** The active tab scope, then its open tab ids, joined by `\n`. */
export const useOpenOwnersKey = (): string | null =>
  useElectronStore((s) =>
    [tabScopeKey(s.activeTabScope), ...s.tabs.map((tab) => tab.id)].join('\n'),
  );
