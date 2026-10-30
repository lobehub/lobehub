'use client';

import { safeParseJSON } from '@lobechat/utils';
import { Flexbox, Skeleton, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { type AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import * as stylex from '@stylexjs/stylex';
import { useLatest } from 'ahooks';
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { useIsDark } from '@/hooks/useIsDark';
import { useClientDataSWR } from '@/libs/swr';
import { mcpAppKeys } from '@/libs/swr/keys';
import { mcpService } from '@/services/mcp';
import { getToolStoreState } from '@/store/tool';

import { anySignal } from './abortSignal';
import { mcpAppNameSelector } from './appName';
import { buildHostContext, connectMcpAppBridge } from './bridge';
import { confirmAppMessage, confirmAppToolCall } from './confirm';
import { getAppToolCallPolicy } from './toolCallPolicy';
import { createViewGestureGate } from './userGesture';
import {
  APP_IFRAME_ALLOW,
  buildAppCsp,
  injectCsp,
  pickAppResource,
  toAppMessage,
  toCallToolResult,
} from './utils';

const DEFAULT_HEIGHT = 320;
const MAX_HEIGHT = 2000;
// Tool calls from one view that may wait for approval at once; more are refused as busy
const MAX_PENDING_TOOL_APPROVALS = 3;

const styles = stylex.create({
  bordered: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  iframe: {
    display: 'block',
    width: '100%',
    borderWidth: '0',
    borderStyle: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  iframeHeight: (height: string) => ({ height }),
});

export interface McpAppViewProps {
  apiName: string;
  /** Raw JSON arguments of the tool call. */
  arguments?: string;
  /** Rendered instead when the view can't be loaded. */
  fallback: ReactNode;
  identifier: string;
  resourceUri: string;
  /** Tool call result envelope (`{ content, state, success }`). */
  result: { content: string; state?: any };
  toolCallId: string;
}

const getAppName = (identifier: string, agentId?: string) =>
  mcpAppNameSelector(identifier, agentId)(getToolStoreState());

/**
 * Renders an MCP Apps (SEP-1865) view: the `ui://` HTML a tool declares, in a
 * sandboxed iframe that talks to LobeHub over the MCP Apps postMessage protocol.
 */
const McpAppView = memo<McpAppViewProps>(
  ({ apiName, arguments: args, fallback, identifier, resourceUri, result, toolCallId }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    // This view's requests still waiting for the user's answer
    const [waitingApprovals, setWaitingApprovals] = useState(0);
    const isDark = useIsDark();
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const agentId = useConversationStore((s) => s.context.agentId) || undefined;
    const { t } = useTranslation('plugin');

    const { data, error, isLoading } = useClientDataSWR(
      mcpAppKeys.resource(identifier, resourceUri, agentId),
      () => mcpService.readMcpAppResource(identifier, resourceUri, agentId),
      { revalidateOnFocus: false, revalidateOnReconnect: false },
    );

    const resource = useMemo(() => pickAppResource(data, resourceUri), [data, resourceUri]);
    const srcDoc = useMemo(
      () => resource && injectCsp(resource.html, buildAppCsp(resource.meta?.csp)),
      [resource],
    );

    // Everything the bridge reads after mount goes through a ref, so the
    // iframe session is created once per document instead of per render.
    const latest = useLatest({ agentId, args, identifier, isDark, result, sendMessage, t });
    const bridgeRef = useRef<AppBridge>(undefined);

    useEffect(() => {
      const iframe = iframeRef.current;
      const target = iframe?.contentWindow;
      if (!srcDoc || !iframe || !target) return;

      const gestures = createViewGestureGate();
      // One message at a time, so a view can't line up runs behind a pending one
      let sending = false;
      // Approvals queue up and open one at a time; a few per view, so a view
      // can't bury the user under modals
      let pendingToolApprovals = 0;
      // Drops this view's approvals, waiting or shown, once it goes away
      const approvals = new AbortController();
      // The view can't see the modal its request waits for, possibly behind
      // another view's, so say under it that it's waiting rather than hung
      const awaitApproval = async (
        request: AbortSignal,
        ask: (signal: AbortSignal) => Promise<boolean>,
      ) => {
        // An approval also lapses once the view stops waiting for its request (it
        // timed out behind other modals): answering it would run work nobody reads
        const { dispose, signal } = anySignal([approvals.signal, request]);
        setWaitingApprovals((count) => count + 1);
        try {
          return await ask(signal);
        } finally {
          dispose();
          setWaitingApprovals((count) => count - 1);
        }
      };

      const { bridge, dispose } = connectMcpAppBridge(target, {
        // Views may only call tools on the server that rendered them, and
        // under the same approval rules as the conversation.
        callTool: async (name, toolArgs, request) => {
          const { agentId: currentAgentId, identifier: currentIdentifier, t: tr } = latest.current;
          const policy = getAppToolCallPolicy(currentIdentifier, name, {
            agentId: currentAgentId,
            toolArgs,
          });
          let allowed = policy === 'allow';
          if (policy === 'confirm') {
            if (pendingToolApprovals >= MAX_PENDING_TOOL_APPROVALS) {
              return {
                content: [{ text: tr('mcpApp.toolCall.busy', { tool: name }), type: 'text' }],
                isError: true,
              };
            }

            pendingToolApprovals += 1;
            try {
              allowed = await awaitApproval(request, (signal) =>
                confirmAppToolCall({
                  appName: getAppName(currentIdentifier, currentAgentId),
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
              content: [{ text: tr('mcpApp.toolCall.rejected', { tool: name }), type: 'text' }],
              isError: true,
            };
          }

          return toCallToolResult(
            await mcpService.invokeMcpToolCall(
              {
                apiName: name,
                arguments: JSON.stringify(toolArgs),
                id: `${toolCallId}:${name}`,
                identifier: currentIdentifier,
                type: 'mcp',
              },
              // The view's HTML came from this machine for a local server, so its calls do too
              { agentId: currentAgentId, localHttpOverIpc: true },
            ),
          );
        },
        hostContext: buildHostContext(latest.current.isDark),
        onSizeChange: (nextHeight) => setHeight(Math.min(nextHeight, MAX_HEIGHT)),
        // A message starts a billed run, and a view can post one on load (every
        // time the topic reopens). Without a fresh gesture in the view just
        // before, the user confirms it first. One gesture covers one message.
        sendMessage: async (text, request) => {
          if (sending) return false;
          // Read before anything async: the activation expires
          const fromUser = gestures.takeGestureIn(iframe);
          sending = true;
          try {
            const { agentId: currentAgentId, identifier: currentIdentifier } = latest.current;
            if (
              !fromUser &&
              !(await awaitApproval(request, (signal) =>
                confirmAppMessage({
                  appName: getAppName(currentIdentifier, currentAgentId),
                  signal,
                  text,
                }),
              ))
            ) {
              return false;
            }

            await latest.current.sendMessage(toAppMessage(text, currentIdentifier));
            return true;
          } finally {
            sending = false;
          }
        },
        toolInput: () => safeParseJSON(latest.current.args || '{}') ?? {},
        toolResult: () => {
          const { result: toolResult } = latest.current;
          return toCallToolResult({ ...toolResult, success: !toolResult.state?.isError });
        },
      });
      bridgeRef.current = bridge;

      return () => {
        bridgeRef.current = undefined;
        approvals.abort();
        gestures.dispose();
        dispose();
      };
    }, [latest, srcDoc, toolCallId]);

    useEffect(() => {
      bridgeRef.current?.setHostContext(buildHostContext(isDark));
    }, [isDark]);

    if (isLoading) return <Skeleton height={DEFAULT_HEIGHT} width={'100%'} />;

    if (error || !srcDoc) {
      if (error) console.warn(`[MCPApp] failed to load ${resourceUri}:`, error);
      return fallback;
    }

    return (
      <Flexbox gap={8}>
        <div {...stylex.props(resource?.meta?.prefersBorder !== false && styles.bordered)}>
          <iframe
            allow={APP_IFRAME_ALLOW}
            ref={iframeRef}
            // No `allow-same-origin`: the view runs on an opaque origin and can
            // reach LobeHub only through the postMessage bridge.
            sandbox="allow-scripts allow-forms"
            srcDoc={srcDoc}
            title={`${identifier} / ${apiName}`}
            {...stylex.props(styles.iframe, styles.iframeHeight(`${height}px`))}
          />
        </div>
        {waitingApprovals > 0 && (
          <Flexbox horizontal align={'center'} gap={8} role={'status'}>
            <Spin size={'small'} />
            <Text fontSize={12} type={'secondary'}>
              {t('mcpApp.waitingApproval')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

McpAppView.displayName = 'McpAppView';

export default McpAppView;
