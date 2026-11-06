import type { McpAppDisplayMode } from '@lobechat/const/mcpApp';
import type { SendMessageParams } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import { createDevtools } from '../middleware/createDevtools';

export interface McpAppViewState {
  availableModes?: McpAppDisplayMode[];
  dismissed?: boolean;
  icon?: string;
  identifier: string;
  messageId?: string;
  mode: 'inline' | 'fullscreen';
  scope: string;
  title: string;
}
export interface McpAppConversationHost {
  agentId?: string;
  sendMessage: (params: SendMessageParams) => Promise<void>;
}
export interface McpAppState {
  contexts: Record<
    string,
    { content: string; identifier: string; scope: string; sent?: string; title: string }
  >;
  hosts: Record<string, McpAppConversationHost>;
  liveCalls: Record<string, boolean>;
  panels: Record<string, boolean>;
  views: Record<string, McpAppViewState>;
}
export const initialState: McpAppState = {
  contexts: {},
  hosts: {},
  liveCalls: {},
  panels: {},
  views: {},
};
export const useMcpAppStore = createWithEqualityFn<McpAppState>()(
  createDevtools('mcpApp')(() => initialState),
  shallow,
);
export const mcpAppSelectors = {
  host: (scope: string) => (s: McpAppState) => s.hosts[scope],
  panelAvailable: (scope: string) => (s: McpAppState) => !!s.panels[scope],
  view: (id: string) => (s: McpAppState) => s.views[id],
};
