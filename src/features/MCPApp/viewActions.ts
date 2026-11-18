import { resolveConnectorLinkParam } from '@lobechat/mecha';
import type { SendMessageParams } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';
import { isRecord } from '@lobechat/utils/object';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { TFunction } from 'i18next';

import { mcpService } from '@/services/mcp';
import { getToolStoreState } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector/selectors';

import { anySignal } from './abortSignal';
import { mcpAppNameSelector } from './appName';
import type { AppDisplayContext, McpAppBridgeHost } from './bridge';
import { confirmAppMessage, confirmAppOpenLink, confirmAppToolCall } from './confirm';
import { sendAppMessage } from './sendAppMessage';
import { getAppToolCallPolicy } from './toolCallPolicy';
import { toCallToolResult } from './utils';

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
  display?: AppDisplayContext;
  identifier: string;
  isDark: boolean;
  lifecycle?: McpAppBridgeHost['lifecycle'];
  /** The account the view acts as, when its arguments cannot name one (an entrypoint's `{}`). */
  linkId?: string;
  /** This desktop's own MCP process produced the result; the view's calls run there. */
  onThisDevice: boolean;
  /** Tool call result envelope (`{ content, state, success }`). */
  result: { content: string; state?: any };
  sendMessage: (params: SendMessageParams) => Promise<void>;
  /** The MCP server the view came from; its tool calls reach no other. */
  server?: string;
  t: TFunction<'plugin'> | ((key: string, options?: Record<string, unknown>) => string);
}

const getAppName = (identifier: string, agentId?: string) =>
  mcpAppNameSelector(identifier, agentId)(getToolStoreState());

/**
 * What LobeHub does for a view's requests (tool calls, messages, links), under
 * the same approval rules as the conversation. Shared by every view protocol:
 * MCP Apps (`connectAppView`) and MCP-UI (`connectMcpUiView`).
 */
export interface AppViewActions {
  /** Call a tool on the server that rendered the view; `request` aborts when the view stops waiting. */
  callTool: (
    name: string,
    toolArgs: Record<string, unknown>,
    request: AbortSignal,
  ) => Promise<CallToolResult>;
  /** Drop the view's approvals, waiting or shown: the view is leaving. */
  dropApprovals: () => void;
  /** End everything the view started: it is gone. */
  end: () => void;
  /** Open an http(s) link once the user agrees; `false` when declined. */
  openLink: (url: string, request: AbortSignal) => Promise<boolean>;
  /** Post a message as the view's own turn once the user agrees; `false` when it wasn't sent. */
  sendMessage: (text: string, request: AbortSignal) => Promise<boolean>;
}

export interface CreateAppViewActionsOptions {
  getContext: () => AppViewContext;
  /** `+1` when one of this view's requests starts waiting for the user, `-1` when it stops. */
  onWaitingApprovalsChange: (delta: 1 | -1) => void;
  toolCallId: string;
}

export const createAppViewActions = ({
  getContext,
  onWaitingApprovalsChange,
  toolCallId,
}: CreateAppViewActionsOptions): AppViewActions => {
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

  return {
    // Views may only call tools on the server that rendered them, and
    // under the same approval rules as the conversation.
    callTool: async (name, toolArgs, request) => {
      const {
        agentId,
        identifier,
        onThisDevice,
        server,
        t,
        args: initiatingArgs,
        linkId: viewLinkId,
      } = getContext();
      const linkId = viewLinkId ?? getMcpAppLinkId(identifier, agentId, initiatingArgs);
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
            { agentId, fromMcpApp: true, onThisDevice, server, signal, linkId },
          ),
        );
      } finally {
        disposeCall();
      }
    },
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
    dropApprovals: () => approvals.abort(),
    end: () => {
      approvals.abort();
      session.abort();
    },
  };
};

/** Bind a view to the account of the tool call that created it. */
export const getMcpAppLinkId = (
  identifier: string,
  agentId?: string,
  args?: string,
): string | undefined => {
  const connector = connectorSelectors.connectorByIdentifierForAgent(
    identifier,
    agentId,
  )(getToolStoreState());
  const param = resolveConnectorLinkParam(connector?.tools.map((tool) => tool.inputSchema) ?? []);
  const input: unknown = safeParseJSON(args ?? '{}');
  return isRecord(input) && typeof input[param] === 'string' ? (input[param] as string) : undefined;
};
