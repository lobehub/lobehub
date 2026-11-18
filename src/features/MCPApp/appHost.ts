import { safeParseJSON } from '@lobechat/utils';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';

import type { McpAppBridgeHost } from './bridge';
import { buildHostContext, connectMcpAppBridge } from './bridge';
import { isAppFrameNavigatedNotice } from './frameDocument';
import { toCallToolResult } from './utils';
import { type AppViewContext, createAppViewActions } from './viewActions';
import { withoutStoredMedia } from './viewToolResult';

export { type AppViewContext, getMcpAppLinkId, MAX_PENDING_TOOL_APPROVALS } from './viewActions';

export const MAX_APP_VIEW_HEIGHT = 2000;
export interface ConnectAppViewOptions {
  getContext: () => AppViewContext;
  onHeight: (height: number) => void;
  /** The view left its document and the wrapper dropped it. */
  onNavigated: () => void;
  /** `+1` when one of this view's requests starts waiting for the user, `-1` when it stops. */
  onWaitingApprovalsChange: (delta: 1 | -1) => void;
  resourceUri: string;
  /** The view's frame window: the wrapper document's. */
  target: Window;
  toolCallId: string;
}

/**
 * Connect LobeHub to one MCP App view: the bridge session plus what LobeHub
 * does for the view's requests (tool calls, messages, links), under the same
 * approval rules as the conversation. Once the view goes away call `dispose`,
 * or `teardown` while its frame still runs: both end the session and drop the
 * view's approvals, waiting or shown.
 */
/** How long a view removed from the page may take to finish (save pending edits). */
export const APP_VIEW_TEARDOWN_TIMEOUT_MS = 3000;

export interface AppViewSession {
  bridge: AppBridge;
  /** End the session at once: the view is already gone. */
  dispose: () => void;
  /**
   * The view is leaving: its context was cleared and must stay so, though its
   * frame still runs (finishing, or waiting for its teardown). Later model
   * context updates from it are dropped.
   */
  retire: () => void;
  /** Let the view finish, within {@link APP_VIEW_TEARDOWN_TIMEOUT_MS}, then end the session. */
  teardown: () => Promise<void>;
}

export const connectAppView = ({
  getContext,
  onHeight,
  onNavigated,
  onWaitingApprovalsChange,
  resourceUri,
  target,
  toolCallId,
}: ConnectAppViewOptions): AppViewSession => {
  const handleFrameNotice = (event: MessageEvent) => {
    if (event.source === target && isAppFrameNavigatedNotice(event.data)) {
      console.warn(`[MCPApp] ${resourceUri} left its document and was removed`);
      onNavigated();
    }
  };
  window.addEventListener('message', handleFrameNotice);

  const actions = createAppViewActions({ getContext, onWaitingApprovalsChange, toolCallId });

  // Set once the view starts leaving; see `AppViewSession.retire`
  let retiring = false;
  const { bridge, dispose, teardown } = connectMcpAppBridge(target, {
    ...(getContext().lifecycle && {
      lifecycle: {
        getDisplayContext: () => getContext().lifecycle!.getDisplayContext(),
        onInitialized: (modes) => getContext().lifecycle!.onInitialized?.(modes),
        onRequestDisplayMode: (mode, modes) =>
          getContext().lifecycle!.onRequestDisplayMode(mode, modes),
        onTeardown: () => getContext().lifecycle!.onTeardown(),
        onUpdateModelContext: (params) => {
          if (!retiring) getContext().lifecycle!.onUpdateModelContext(params);
        },
      } satisfies NonNullable<McpAppBridgeHost['lifecycle']>,
    }),
    callTool: actions.callTool,
    hostContext: buildHostContext(getContext().isDark, getContext().display),
    getHostContext: () => buildHostContext(getContext().isDark, getContext().display),
    onSizeChange: (nextHeight) => onHeight(Math.min(nextHeight, MAX_APP_VIEW_HEIGHT)),
    openLink: actions.openLink,
    sendMessage: actions.sendMessage,
    toolInput: () => safeParseJSON(getContext().args || '{}') ?? {},
    // The chat stored this result's media as uploads; the view reads base64
    toolResult: () => {
      const { result } = getContext();
      return withoutStoredMedia(toCallToolResult({ ...result, success: !result.state?.isError }));
    },
  });

  const end = () => {
    window.removeEventListener('message', handleFrameNotice);
    actions.end();
  };

  return {
    bridge,
    dispose: () => {
      end();
      dispose();
    },
    // Prompts go at once; calls that need none still run while the view
    // finishes (saves its edits), and end with it
    retire: () => {
      retiring = true;
    },
    teardown: async () => {
      retiring = true;
      actions.dropApprovals();
      try {
        await teardown(APP_VIEW_TEARDOWN_TIMEOUT_MS);
      } finally {
        end();
      }
    },
  };
};

export type AppViewPhase = 'fallback' | 'loading' | 'view';

/**
 * What a view's slot shows. A failed revalidation keeps a view that already
 * loaded: whether the iframe (and the bridge bound to it) exists depends on the
 * document alone, never on a later fetch error.
 */
export const getAppViewPhase = ({
  isLoading,
  navigated,
  srcDoc,
}: {
  isLoading: boolean;
  navigated: boolean;
  srcDoc?: string;
}): AppViewPhase => {
  if (isLoading) return 'loading';
  if (!srcDoc || navigated) return 'fallback';
  return 'view';
};
