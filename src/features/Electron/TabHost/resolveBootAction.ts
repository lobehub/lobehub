import { isSameTabTarget } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';

export type BootAction =
  { type: 'keep' } | { id: string; type: 'activate' } | { type: 'add'; url: string };

export const resolveBootAction = (
  tabs: TabItem[],
  activeTabId: string | null,
  bootUrl: string,
): BootAction => {
  const isDefaultLaunch = normalizeTabUrl(bootUrl) === '/';
  const activeTabExists = !!activeTabId && tabs.some((tab) => tab.id === activeTabId);

  if (isDefaultLaunch && activeTabExists) return { type: 'keep' };

  const match = tabs.find((tab) => isSameTabTarget(tab, bootUrl));
  if (match) return { id: match.id, type: 'activate' };

  return { type: 'add', url: bootUrl };
};
