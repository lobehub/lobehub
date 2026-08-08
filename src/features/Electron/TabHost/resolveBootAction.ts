import { isSameTabTarget, resolveTabScope } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';

export type BootAction =
  { type: 'keep' } | { id: string; type: 'activate'; url?: string } | { type: 'add'; url: string };

const scopeRootUrl = (bootUrl: string): string => {
  const scope = resolveTabScope(bootUrl);
  return scope.type === 'workspace' ? `/${scope.slug}` : '/';
};

export const resolveBootAction = (
  tabs: TabItem[],
  activeTabId: string | null,
  bootUrl: string,
): BootAction => {
  // A scope-root boot url (`/`, or `/{slug}` when the main process restores the
  // last workspace) is a plain launch, not a deep link: keep the scope's last
  // active tab instead of forcing its home tab to the front.
  const isDefaultLaunch = normalizeTabUrl(bootUrl) === scopeRootUrl(bootUrl);
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
