import { useGlobalStore } from '@/store/global';

import { isSafeExternalUrl } from './descriptors';

const GITHUB_PULL_REQUEST_URL =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[#/?]|$)/i;

/** `owner/repo#n` of a GitHub PR URL (GitHub names are case-insensitive), or `null`. */
const getPullRequestKey = (url?: string | null): string | null => {
  const match = url?.match(GITHUB_PULL_REQUEST_URL);
  return match ? `${match[1]}/${match[2]}#${match[3]}`.toLowerCase() : null;
};

/** Both URLs point at the same GitHub PR, ignoring sub-pages, query and fragment. */
export const isSamePullRequestUrl = (a?: string | null, b?: string | null): boolean => {
  const key = getPullRequestKey(a);
  return !!key && key === getPullRequestKey(b);
};

/**
 * Open an external Work. A PR the Working Sidebar already shows (live state,
 * checks, merge) opens that tab rather than leaving the app; anything else goes
 * to its URL.
 */
export const openExternalWork = (url: string): void => {
  const global = useGlobalStore.getState();
  if (isSamePullRequestUrl(url, global.workingSidebarPullRequestUrl)) {
    global.openWorkingSidebar('pr');
    return;
  }
  // Defense in depth: only ever hand http(s) to shell.openExternal.
  if (isSafeExternalUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
};
