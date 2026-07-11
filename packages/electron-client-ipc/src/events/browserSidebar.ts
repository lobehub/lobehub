import type {
  BrowserSidebarAgentCursorPayload,
  BrowserSidebarAgentStatePayload,
} from '../types/browserControl';
import type { BrowserSidebarState } from '../types/browserSidebar';

export interface BrowserSidebarBroadcastEvents {
  browserSidebarAgentCursor: (data: BrowserSidebarAgentCursorPayload) => void;
  browserSidebarAgentState: (data: BrowserSidebarAgentStatePayload) => void;
  browserSidebarStateChanged: (data: BrowserSidebarState) => void;
}
