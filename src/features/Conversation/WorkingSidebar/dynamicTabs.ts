import type { IconProps } from '@lobehub/ui';
import type { ReactNode } from 'react';

import { CANVAS_TAB_PREFIX } from '@/store/global/initialState';

export interface SidebarTabDescriptor {
  icon: IconProps['icon'];
  iconNode?: ReactNode;
  key: string;
  label: ReactNode;
}

export interface BrowserTabMetadata {
  faviconUrl?: string;
  title: string;
  url: string;
}

export const BROWSER_TAB_KEY = 'browser';
export const BROWSER_TAB_PREFIX = 'browser:';

export const isBrowserTab = (tab: string) =>
  tab === BROWSER_TAB_KEY || tab.startsWith(BROWSER_TAB_PREFIX);

export const isCanvasTab = (tab: string) => tab.startsWith(CANVAS_TAB_PREFIX);

// Browser pages and canvases belong to one conversation, so pinning them across
// every topic of the agent would reopen content that does not exist there.
export const isDynamicTab = (tab: string) => isBrowserTab(tab) || isCanvasTab(tab);

export const browserSessionIdOfTab = (baseSessionId: string, tab: string) =>
  tab === BROWSER_TAB_KEY
    ? baseSessionId
    : `${baseSessionId}:tab:${tab.slice(BROWSER_TAB_PREFIX.length)}`;
