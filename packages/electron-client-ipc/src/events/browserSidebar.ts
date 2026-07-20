import type { BrowserGatewayToolCallPayload } from '../types/browserControl';
import type { BrowserSidebarState } from '../types/browserSidebar';

export interface BrowserSidebarBroadcastEvents {
  browserSidebarGatewayToolCall: (data: BrowserGatewayToolCallPayload) => void;
  browserSidebarStateChanged: (data: BrowserSidebarState) => void;
}
