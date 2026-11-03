import { isDesktop } from '@/const/version';

/**
 * Check if user is performing a modifier click (Cmd+Click on Mac, Ctrl+Click on other OS)
 * to open link in new tab. Always returns false on desktop (Electron) since
 * there's no browser tab concept.
 */
export const isModifierClick = (e: { ctrlKey: boolean; metaKey: boolean }): boolean => {
  if (isDesktop) return false;
  return e.metaKey || e.ctrlKey;
};
