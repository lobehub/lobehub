import { restoreTabWhenHidden } from '@/features/Electron/TabHost/hiddenTabRestore';
import { getTabRouter } from '@/features/Electron/TabHost/tabRouterManager';
import { normalizeTabUrl } from '@/features/Electron/titlebar/TabBar/url';
import { useElectronStore } from '@/store/electron';

interface ClickOrigin {
  tabId: string;
  topicId: string;
  url: string;
}

let lastClickOrigin: ClickOrigin | null = null;

// A single click navigates the active tab at once, so by the time the double
// click arrives that tab already shows the topic. Remember where it was so the
// double click can open the topic in a new tab and put the clicked tab back.
export const recordTopicClickOrigin = (topicId: string): void => {
  const { activeTabId } = useElectronStore.getState();
  const location = activeTabId ? getTabRouter(activeTabId)?.state.location : undefined;

  lastClickOrigin =
    activeTabId && location
      ? {
          tabId: activeTabId,
          topicId,
          url: `${location.pathname}${location.search}${location.hash}`,
        }
      : null;
};

export const openTopicInNewTab = (topicId: string, url: string): void => {
  const origin = lastClickOrigin?.topicId === topicId ? lastClickOrigin : null;
  lastClickOrigin = null;

  const electron = useElectronStore.getState();
  const target = normalizeTabUrl(url);

  if (!origin || normalizeTabUrl(origin.url) === target) {
    electron.addTab(url);
    return;
  }

  const existing = electron.tabs.find(
    (tab) => tab.id !== origin.tabId && normalizeTabUrl(tab.url) === target,
  );
  if (existing) electron.activateTab(existing.id);
  else electron.addNewTab(url);

  restoreTabWhenHidden(origin.tabId, { from: url, to: origin.url });
};
