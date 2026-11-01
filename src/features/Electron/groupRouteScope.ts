export const shouldSyncGroupRoute = (
  isDesktop: boolean,
  tabId: string | null,
  activeTabId: string | null,
): boolean => !isDesktop || tabId === null || tabId === activeTabId;
