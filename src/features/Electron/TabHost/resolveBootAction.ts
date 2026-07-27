import { isSameTabTarget } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';

export type BootAction =
  { type: 'keep' } | { id: string; type: 'activate'; url?: string } | { type: 'add'; url: string };

export const resolveBootAction = (
  tabs: TabItem[],
  activeTabId: string | null,
  bootUrl: string,
): BootAction => {
  const isDefaultLaunch = normalizeTabUrl(bootUrl) === '/';
  const activeTabExists = !!activeTabId && tabs.some((tab) => tab.id === activeTabId);

  if (isDefaultLaunch && activeTabExists) return { type: 'keep' };

  // Tab identity ignores the fragment, so a matched tab can still sit at a
  // different anchor than the launch url — carry the exact url over.
  const match = tabs.find((tab) => isSameTabTarget(tab, bootUrl));
  if (match)
    return match.url === bootUrl
      ? { id: match.id, type: 'activate' }
      : { id: match.id, type: 'activate', url: bootUrl };

  return { type: 'add', url: bootUrl };
};
