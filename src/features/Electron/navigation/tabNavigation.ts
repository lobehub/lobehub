import { isSameTabTarget } from '@/features/Electron/titlebar/TabBar/scope';
import { type TabItem } from '@/features/Electron/titlebar/TabBar/types';

export type TabNavigationAction =
  | {
      type: 'activate';
      id: string;
    }
  | {
      type: 'add';
      url: string;
    }
  | {
      type: 'none';
    }
  | {
      id: string;
      type: 'update';
      url: string;
    };

interface ResolveTabNavigationActionInput {
  activeTabId: string | null;
  currentUrl: string;
  tabs: TabItem[];
}

export const resolveTabNavigationAction = ({
  activeTabId,
  currentUrl,
  tabs,
}: ResolveTabNavigationActionInput): TabNavigationAction => {
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;

  if (activeTab && isSameTabTarget(activeTab, currentUrl)) {
    return activeTab.url === currentUrl
      ? { type: 'none' }
      : { id: activeTab.id, type: 'update', url: currentUrl };
  }

  const existing = tabs.find((t) => isSameTabTarget(t, currentUrl));
  if (existing) return { id: existing.id, type: 'activate' };

  if (!activeTab) return { type: 'add', url: currentUrl };

  return { id: activeTab.id, type: 'update', url: currentUrl };
};
