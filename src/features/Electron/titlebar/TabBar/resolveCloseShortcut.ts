import { isSameTabTarget, type TabScope, tabScopeHomeUrl } from './scope';
import { type TabItem } from './types';

export type CloseShortcutAction = { id: string; type: 'closeTab' } | { type: 'closeWindow' };

// Closing the last tab lands on a fresh home tab, so a lone tab already at home has
// nowhere further to go; there the shortcut falls back to closing the window, or it
// would never close it at all.
export const resolveCloseShortcut = (
  tabs: TabItem[],
  activeTabId: string | null,
  scope: TabScope,
): CloseShortcutAction => {
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (!active) return { type: 'closeWindow' };

  const isLoneHomeTab = tabs.length === 1 && isSameTabTarget(active, tabScopeHomeUrl(scope));
  if (isLoneHomeTab) return { type: 'closeWindow' };

  return { id: active.id, type: 'closeTab' };
};
