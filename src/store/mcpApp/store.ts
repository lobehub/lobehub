import type { McpAppDisplayMode } from '@lobechat/const/mcpApp';
import type { SendMessageParams } from '@lobechat/types';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

import type { MCPToolCallResult } from '@/libs/mcp';

import { createDevtools } from '../middleware/createDevtools';

export interface McpAppViewState {
  availableModes?: McpAppDisplayMode[];
  dismissed?: boolean;
  /** The host instance whose frame runs the app now; see `mcpAppActions.ownFrame`. */
  frameOwner?: number;
  icon?: string;
  identifier: string;
  /**
   * A side panel tab shows it: a tab open (or restored with the conversation)
   * keeps the view in the panel whatever its metadata first declared.
   */
  inPanel?: boolean;
  /** It came from a call completed in the live conversation, which opens its side panel. */
  live?: boolean;
  messageId?: string;
  mode: 'inline' | 'fullscreen';
  /** Its location was decided from what the tool and resource declare. */
  placed?: boolean;
  scope: string;
  /** The app reported its own modes once; later moves are the app's requests. */
  settled?: boolean;
  title: string;
}
/** A thread entrypoint tab's `{}` tool call: one per tab instance (topic and entrypoint). */
export interface McpAppEntryState {
  /** Bumped per call, so an older call's answer never replaces a newer one. */
  request: number;
  result?: MCPToolCallResult;
  status: 'error' | 'opening' | 'ready';
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
  entries: Record<string, McpAppEntryState>;
  hosts: Record<string, McpAppConversationHost>;
  liveCalls: Record<string, boolean>;
  panels: Record<string, boolean>;
  views: Record<string, McpAppViewState>;
}
export const initialState: McpAppState = {
  discoveryAttempts: {},
  contexts: {},
  entries: {},
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
  entry: (id: string) => (s: McpAppState) => s.entries[id],
  host: (scope: string) => (s: McpAppState) => s.hosts[scope],
  panelAvailable: (scope: string) => (s: McpAppState) => !!s.panels[scope],
  view: (id: string) => (s: McpAppState) => s.views[id],
};
