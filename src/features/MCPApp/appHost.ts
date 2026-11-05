import type { SendMessageParams } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { TFunction } from 'i18next';

import { mcpService } from '@/services/mcp';
import { getToolStoreState } from '@/store/tool';

import { anySignal } from './abortSignal';
import { mcpAppNameSelector } from './appName';
import { buildHostContext, connectMcpAppBridge } from './bridge';
import { confirmAppMessage, confirmAppOpenLink, confirmAppToolCall } from './confirm';
import { isAppFrameNavigatedNotice } from './frameDocument';
import { sendAppMessage } from './sendAppMessage';
import { getAppToolCallPolicy } from './toolCallPolicy';
import { toCallToolResult } from './utils';
import { withoutStoredMedia } from './viewToolResult';

export const MAX_APP_VIEW_HEIGHT = 2000;
// Tool calls from one view that may wait for approval at once; more are refused as busy
export const MAX_PENDING_TOOL_APPROVALS = 3;

/** What the view's session reads when a request arrives: the latest render's values. */
export interface AppViewContext {
  agentId?: string;
  /** Raw JSON arguments of the tool call. */
  args?: string;
  /**
   * The conversation surface takes new messages: its composer is writable. A
   * read-only one (a thread a tool started) keeps the view from posting too.
   */
  canSendMessage: boolean;
  identifier: string;
  isDark: boolean;
  /** This desktop's own MCP process produced the result; the view's calls run there. */
  onThisDevice: boolean;
  /** Tool call result envelope (`{ content, state, success }`). */
  result: { content: string; state?: any };
  sendMessage: (params: SendMessageParams) => Promise<void>;
  /** The MCP server the view came from; its tool calls reach no other. */
  server?: string;
  t: TFunction<'plugin'> | ((key: string, options?: Record<string, unknown>) => string);
}

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

const getAppName = (identifier: string, agentId?: string) =>
  mcpAppNameSelector(identifier, agentId)(getToolStoreState());

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

  // One message at a time, so a view can't line up runs behind a pending one
  let sending = false;
  // One link prompt at a time, so a view can't stack them up
  let linking = false;
  // Approvals queue up and open one at a time; a few per view, so a view
  // can't bury the user under modals
  let pendingToolApprovals = 0;
  // Drops this view's approvals, waiting or shown, once it goes away (or
  // starts to): nobody can see a prompt for a view being removed
  const approvals = new AbortController();
  // Ends what the view started, once it is gone. Later than `approvals` during
  // a teardown: the view may still save its edits through a tool call then.
  const session = new AbortController();
  // The view can't see the modal its request waits for, possibly behind
  // another view's, so say under it that it's waiting rather than hung
  const awaitApproval = async (
    request: AbortSignal,
    ask: (signal: AbortSignal) => Promise<boolean>,
  ) => {
    // An approval also lapses once the view stops waiting for its request (it
    // timed out behind other modals): answering it would run work nobody reads
    const { dispose, signal } = anySignal([approvals.signal, request]);
    onWaitingApprovalsChange(1);
    try {
      return await ask(signal);
    } finally {
      dispose();
      onWaitingApprovalsChange(-1);
    }
  };

  const { bridge, dispose, teardown } = connectMcpAppBridge(target, {
    // Views may only call tools on the server that rendered them, and
    // under the same approval rules as the conversation.
    callTool: async (name, toolArgs, request) => {
      const { agentId, identifier, onThisDevice, server, t } = getContext();
      const policy = await getAppToolCallPolicy(identifier, name, { agentId, toolArgs });
      let allowed = policy === 'allow';
      if (policy === 'confirm') {
        if (pendingToolApprovals >= MAX_PENDING_TOOL_APPROVALS) {
          return {
            content: [{ text: t('mcpApp.toolCall.busy', { tool: name }), type: 'text' }],
            isError: true,
          };
        }

        pendingToolApprovals += 1;
        try {
          allowed = await awaitApproval(request, (signal) =>
            confirmAppToolCall({
              appName: getAppName(identifier, agentId),
              args: toolArgs,
              signal,
              tool: name,
            }),
          );
        } finally {
          pendingToolApprovals -= 1;
        }
      }

      if (!allowed) {
        return {
          content: [{ text: t('mcpApp.toolCall.rejected', { tool: name }), type: 'text' }],
          isError: true,
        };
      }

      // The view may have gone, or stopped waiting, while the policy loaded
      // or an approval was open: nobody would read the result, so don't run it.
      const { dispose: disposeCall, signal } = anySignal([session.signal, request]);
      try {
        if (signal.aborted) throw new DOMException('The view stopped waiting', 'AbortError');

        return toCallToolResult(
          await mcpService.invokeMcpToolCall(
            {
              apiName: name,
              arguments: JSON.stringify(toolArgs),
              id: `${toolCallId}:${name}`,
              identifier,
              type: 'mcp',
            },
            // The view's HTML came from this machine for a local server, so its calls do too
            { agentId, fromMcpApp: true, onThisDevice, server, signal },
          ),
        );
      } finally {
        disposeCall();
      }
    },
    hostContext: buildHostContext(getContext().isDark),
    onSizeChange: (nextHeight) => onHeight(Math.min(nextHeight, MAX_APP_VIEW_HEIGHT)),
    // A view can ask without a gesture and carry data in the URL, so the
    // user sees the link before it opens
    openLink: async (url, request) => {
      if (linking) return false;
      linking = true;
      try {
        const { agentId, identifier } = getContext();
        const allowed = await awaitApproval(request, (signal) =>
          confirmAppOpenLink({ appName: getAppName(identifier, agentId), signal, url }),
        );
        if (allowed) window.open(url, '_blank', 'noopener,noreferrer');

        return allowed;
      } finally {
        linking = false;
      }
    },
    // A message starts a billed run. Parent activation and iframe focus
    // cannot prove which opaque-origin view the user acted in, so every
    // message needs consent in the host.
    sendMessage: async (text, request) => {
      if (sending || !getContext().canSendMessage) return false;
      sending = true;
      try {
        const { agentId, identifier } = getContext();
        if (
          !(await awaitApproval(request, (signal) =>
            confirmAppMessage({ appName: getAppName(identifier, agentId), signal, text }),
          ))
        ) {
          return false;
        }

        // Until the conversation accepts it, the view going away or giving up
        // on the request cancels the send rather than starting a reply
        // Its lifetime is the prompts', not the session's: a view being removed
        // may still save its edits, but never starts a reply
        const { dispose: disposeSend, signal } = anySignal([approvals.signal, request]);
        try {
          return await sendAppMessage(getContext().sendMessage, text, identifier, signal);
        } finally {
          disposeSend();
        }
      } finally {
        sending = false;
      }
    },
    toolInput: () => safeParseJSON(getContext().args || '{}') ?? {},
    // The chat stored this result's media as uploads; the view reads base64
    toolResult: () => {
      const { result } = getContext();
      return withoutStoredMedia(toCallToolResult({ ...result, success: !result.state?.isError }));
    },
  });

  const end = () => {
    window.removeEventListener('message', handleFrameNotice);
    approvals.abort();
    session.abort();
  };

  return {
    bridge,
    dispose: () => {
      end();
      dispose();
    },
    // Prompts go at once; calls that need none still run while the view
    // finishes (saves its edits), and end with it
    teardown: async () => {
      approvals.abort();
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
