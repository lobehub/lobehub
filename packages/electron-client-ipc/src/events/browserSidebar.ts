import type { BrowserSidebarState } from '../types/browserSidebar';

export interface BrowserSidebarBroadcastEvents {
  browserSidebarStateChanged: (data: BrowserSidebarState) => void;
}
