'use client';

import type { McpUiEmbeddedResource } from '@lobechat/const/mcpApp';
import { Flexbox, Spin, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useLatest } from 'ahooks';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { getToolStoreState } from '@/store/tool';

import { mcpAppNameSelector } from './appName';
import {
  buildAppFrameDocument,
  buildExternalFrameDocument,
  isAppFrameNavigatedNotice,
  isRenderableExternalUrl,
  VIEW_FRAME_SANDBOX,
} from './frameDocument';
import { connectMcpUiView, type McpUiViewSession } from './mcpUiHost';
import { APP_IFRAME_ALLOW, buildAppCsp } from './utils';
import type { AppViewContext } from './viewActions';

const DEFAULT_HEIGHT = 320;

const styles = stylex.create({
  frame: {
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

/**
 * The wrapper document a resource renders in, or `undefined` when it can't
 * render here. Embedded HTML declares no domains, so it gets no network access.
 */
export const buildMcpUiFrameDocument = (
  resource: McpUiEmbeddedResource,
  hostOrigin: string,
): string | undefined => {
  if (resource.kind === 'html') return buildAppFrameDocument(resource.html, buildAppCsp(undefined));
  return isRenderableExternalUrl(resource.url, hostOrigin)
    ? buildExternalFrameDocument(resource.url)
    : undefined;
};

export interface McpUiResourceViewProps {
  apiName: string;
  /** Raw JSON arguments of the tool call. */
  arguments?: string;
  host: Pick<AppViewContext, 'agentId' | 'canSendMessage' | 'sendMessage'>;
  identifier: string;
  /** This desktop's own MCP process produced the result: the view's calls run there. */
  onThisDevice?: boolean;
  resource: McpUiEmbeddedResource;
  /** Tool call result envelope (`{ content, state, success }`). */
  result: { content: string; state?: any };
  /** The MCP server the result came from; the view's calls reach no other. */
  server?: string;
  toolCallId: string;
}

/**
 * Renders one MCP-UI view a tool result embeds (`ui://`, `text/html` or
 * `text/uri-list`) in the same sandboxed, CSP-bound frame as an MCP Apps view,
 * talking to LobeHub over the MCP-UI postMessage protocol.
 */
const McpUiResourceView = memo<McpUiResourceViewProps>(
  ({
    apiName,
    arguments: args,
    host,
    identifier,
    onThisDevice = false,
    resource,
    result,
    server,
    toolCallId,
  }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(DEFAULT_HEIGHT);
    const [waitingApprovals, setWaitingApprovals] = useState(0);
    const isDark = useIsDark();
    const { t } = useTranslation('plugin');
    const { agentId, canSendMessage, sendMessage } = host;

    // A string: the effects below compare it by value, so no memo is needed
    const srcDoc = buildMcpUiFrameDocument(resource, window.location.origin);
    // The document whose view left it, so the wrapper dropped the view
    const [droppedDoc, setDroppedDoc] = useState<string>();
    const navigated = !!srcDoc && droppedDoc === srcDoc;

    const latest = useLatest<AppViewContext>({
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
    const sessionRef = useRef<McpUiViewSession>(undefined);

    useEffect(() => {
      const target = iframeRef.current?.contentWindow;
      if (!srcDoc || navigated || !target) return;

      const handleNotice = (event: MessageEvent) => {
        if (event.source !== target || !isAppFrameNavigatedNotice(event.data)) return;
        console.warn(`[MCP-UI] ${resource.uri} left its document and was removed`);
        setDroppedDoc(srcDoc);
      };
      window.addEventListener('message', handleNotice);

      const session = connectMcpUiView({
        getContext: () => latest.current,
        notify: (message) =>
          toast.info({
            description: message,
            title: mcpAppNameSelector(identifier, agentId)(getToolStoreState()),
          }),
        onHeight: setHeight,
        onWaitingApprovalsChange: (delta) => setWaitingApprovals((count) => count + delta),
        target,
        toolCallId,
      });
      sessionRef.current = session;

      return () => {
        window.removeEventListener('message', handleNotice);
        sessionRef.current = undefined;
        session.dispose();
      };
    }, [agentId, identifier, latest, navigated, resource.uri, srcDoc, toolCallId]);

    // A theme change reaches a view that already rendered
    useEffect(() => {
      sessionRef.current?.sendRenderData();
    }, [isDark]);

    if (!srcDoc || navigated) return null;

    return (
      <Flexbox gap={8}>
        <div {...stylex.props(styles.frame)}>
          <iframe
            allow={APP_IFRAME_ALLOW}
            data-mcp-ui-uri={resource.uri}
            ref={iframeRef}
            // No `allow-same-origin`: the view runs on an opaque origin and can
            // reach LobeHub only through the postMessage protocol. The frame
            // loads the wrapper, which holds the view to its document (HTML) or
            // its page's origin (an external URL).
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

McpUiResourceView.displayName = 'McpUiResourceView';

export default McpUiResourceView;
