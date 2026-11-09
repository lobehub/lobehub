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
  /** Its location was decided from what the tool and resource declare. */
  placed?: boolean;
  scope: string;
  /** The app reported its own modes once; later moves are the app's requests. */
  settled?: boolean;
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
  discoveryAttempts: Record<string, number>;
  hosts: Record<string, McpAppConversationHost>;
  liveCalls: Record<string, boolean>;
  panels: Record<string, boolean>;
  views: Record<string, McpAppViewState>;
}
export const initialState: McpAppState = {
  discoveryAttempts: {},
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
