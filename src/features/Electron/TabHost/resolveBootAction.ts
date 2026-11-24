import {
  isSameTabTarget,
  resolveTabScope,
  tabScopeHomeUrl,
} from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';

// The main process appends `lng` to every renderer load (Browser.buildUrlWithLocale)
// and index.html consumes it before React mounts. It describes the window, not the
// route, so it must stay out of tab identity — otherwise a plain launch reads as a
// deep link into `/?lng=…`, matches no persisted tab, and seeds a duplicate one.
export const readBootUrl = ({
  hash,
  pathname,
  search,
}: Pick<Location, 'hash' | 'pathname' | 'search'>): string => {
  const params = new URLSearchParams(search);
  if (!params.has('lng')) return `${pathname}${search}${hash}`;

  params.delete('lng');
  const query = params.toString();

  return `${pathname}${query ? `?${query}` : ''}${hash}`;
};

export type BootAction =
  { type: 'keep' } | { id: string; type: 'activate'; url?: string } | { type: 'add'; url: string };

export const resolveBootAction = (
  tabs: TabItem[],
  activeTabId: string | null,
  bootUrl: string,
): BootAction => {
  // A scope-root boot url (`/`, or `/{slug}` when the main process restores the
  // last workspace) is a plain launch, not a deep link: keep the scope's last
  // active tab instead of forcing its home tab to the front.
  const isDefaultLaunch = normalizeTabUrl(bootUrl) === tabScopeHomeUrl(resolveTabScope(bootUrl));
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
