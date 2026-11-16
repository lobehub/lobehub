import { useElectronStore } from '@/store/electron';

/**
 * Which history a location belongs to: each Electron tab (or split pane) keeps
 * its own, so focusing another tab is not a navigation.
 */
export const useLocationOwner = (): string => useElectronStore((s) => s.activeTabId) ?? 'main';
