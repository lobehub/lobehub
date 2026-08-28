'use client';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { type ElectronStore, useElectronStore } from '@/store/electron';

const selectActiveTabPathname = (s: ElectronStore): string | null => {
  const url = selectActiveTabUrl(s);
  if (!url) return null;

  const queryIndex = url.search(/[#?]/);
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
};

// The desktop shell (where workspace context mounts) lives outside the per-tab
// memory routers, so its `useLocation` stays frozen at the boot url —
// `useWindowUrlMirror` only calls `replaceState` and deliberately never
// navigates the root router. Follow the active tab instead, falling back to the
// window url for the frame before `useSeedTabsOnBoot` fills the tab list.
export const useWorkspaceSyncPathname = (): string => {
  const activeTabPathname = useElectronStore(selectActiveTabPathname);

  return activeTabPathname ?? window.location.pathname;
};
