'use client';

import { Flexbox, Skeleton, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { type AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import * as stylex from '@stylexjs/stylex';
import { useLatest } from 'ahooks';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation/store';
import { useIsDark } from '@/hooks/useIsDark';
import { useToolStore } from '@/store/tool';

import { connectAppView, getAppViewPhase } from './appHost';
import { buildHostContext } from './bridge';
import { buildAppFrameDocument, VIEW_FRAME_SANDBOX } from './frameDocument';
import { APP_IFRAME_ALLOW, buildAppCsp, pickAppResource } from './utils';
import { mcpAppAgentIdSelector } from './viewAgent';

const DEFAULT_HEIGHT = 320;

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
  /** The message carrying the result; its agent is the one the view acts as. */
  messageId?: string;
  /** This desktop's own MCP process produced the result: the view is read, and calls, there. */
  onThisDevice?: boolean;
  resourceUri: string;
  /** Tool call result envelope (`{ content, state, success }`). */
  result: { content: string; state?: any };
  /** The MCP server the result came from; the view is read from no other. */
  server?: string;
  toolCallId: string;
}

/**
 * Renders an MCP Apps (SEP-1865) view: the `ui://` HTML a tool declares, in a
 * sandboxed iframe that talks to LobeHub over the MCP Apps postMessage protocol.
 */
const McpAppView = memo<McpAppViewProps>(
  ({
    apiName,
    arguments: args,
    fallback,
    identifier,
    messageId,
    onThisDevice = false,
    resourceUri,
    result,
    server,
    toolCallId,
  }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    // This view's requests still waiting for the user's answer
    const [waitingApprovals, setWaitingApprovals] = useState(0);
    const isDark = useIsDark();
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const canSendMessage = useConversationStore((s) => s.composerTarget.writable);
    // The agent that produced the result: in a group, the member, not the supervisor
    const agentId = useConversationStore(mcpAppAgentIdSelector(messageId));
    const { t } = useTranslation('plugin');

    const useFetchMcpAppResource = useToolStore((s) => s.useFetchMcpAppResource);
    const { data, error, isLoading } = useFetchMcpAppResource(identifier, resourceUri, {
      agentId,
      onThisDevice,
      server,
    });

    const resource = pickAppResource(data, resourceUri);
    // A string: the effects below compare it by value, so no memo is needed
    const srcDoc =
      resource && buildAppFrameDocument(resource.html, buildAppCsp(resource.meta?.csp));
    // The document whose view tried to leave it, so the wrapper dropped the view
    const [droppedDoc, setDroppedDoc] = useState<string>();
    const navigated = !!srcDoc && droppedDoc === srcDoc;

    // Everything the bridge reads after mount goes through a ref, so the
    // iframe session is created once per document instead of per render.
    const latest = useLatest({
      agentId,
      args,
      canSendMessage,
      identifier,
      isDark,
      onThisDevice,
      result,
      sendMessage,
      server,
      t,
    });
    const bridgeRef = useRef<AppBridge>(undefined);

    useEffect(() => {
      const target = iframeRef.current?.contentWindow;
      if (!srcDoc || navigated || !target) return;

      const { bridge, dispose } = connectAppView({
        getContext: () => latest.current,
        onHeight: setHeight,
        onNavigated: () => setDroppedDoc(srcDoc),
        onWaitingApprovalsChange: (delta) => setWaitingApprovals((count) => count + delta),
        resourceUri,
        target,
        toolCallId,
      });
      bridgeRef.current = bridge;

      return () => {
        bridgeRef.current = undefined;
        dispose();
      };
    }, [latest, navigated, resourceUri, srcDoc, toolCallId]);

    useEffect(() => {
      bridgeRef.current?.setHostContext(buildHostContext(isDark));
    }, [isDark]);

    useEffect(() => {
      if (error) console.warn(`[MCPApp] failed to load ${resourceUri}:`, error);
    }, [error, resourceUri]);

    const phase = getAppViewPhase({ isLoading, navigated, srcDoc });
    if (phase === 'loading') return <Skeleton height={DEFAULT_HEIGHT} width={'100%'} />;
    if (phase === 'fallback') return fallback;

    return (
      <Flexbox gap={8}>
        <div {...stylex.props(resource?.meta?.prefersBorder !== false && styles.bordered)}>
          <iframe
            allow={APP_IFRAME_ALLOW}
            ref={iframeRef}
            // No `allow-same-origin`: the view runs on an opaque origin and can
            // reach LobeHub only through the postMessage bridge. The frame loads
            // the wrapper, which holds the view to its declared frame domains.
            sandbox={VIEW_FRAME_SANDBOX}
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
