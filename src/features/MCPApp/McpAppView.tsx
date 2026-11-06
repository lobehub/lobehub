'use client';

import type { McpAppDisplayMode, McpUiResourceMeta } from '@lobechat/const/mcpApp';
import { Flexbox, Skeleton, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { type AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import * as stylex from '@stylexjs/stylex';
import { useLatest } from 'ahooks';
import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { useToolStore } from '@/store/tool';
import { sx } from '@/styles/sx';

import {
  type AppViewContext,
  type AppViewSession,
  connectAppView,
  getAppViewPhase,
} from './appHost';
import { buildHostContext } from './bridge';
import { availableDisplayModes, requestedDisplayMode, resolveDisplayMode } from './displayMode';
import { buildAppFrameDocument, VIEW_FRAME_SANDBOX } from './frameDocument';
import { retireAppFrame } from './frameRetire';
import { APP_IFRAME_ALLOW, buildAppCsp, pickAppResource } from './utils';

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
  host: Pick<AppViewContext, 'agentId' | 'sendMessage' | 'canSendMessage'>;
  identifier: string;
  /** The message carrying the result; its agent is the one the view acts as. */
  messageId?: string;
  /** This desktop's own MCP process produced the result: the view is read, and calls, there. */
  onThisDevice?: boolean;
  presentation?: {
    autoOpen?: boolean;
    hostModes: McpAppDisplayMode[];
    mode: 'inline' | 'fullscreen';
    onInitialized: (modes: McpAppDisplayMode[], preferred: McpAppDisplayMode) => void;
    onMode: (mode: McpAppDisplayMode) => McpAppDisplayMode;
    onTeardown: () => void;
    onDispose: () => void;
    onUpdateModelContext: NonNullable<AppViewContext['lifecycle']>['onUpdateModelContext'];
    preferred?: 'inline' | 'fullscreen';
    retireOnRemove: () => boolean;
  };
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
    host,
    presentation,
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
    const { agentId, sendMessage, canSendMessage } = host;
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [appModes, setAppModes] = useState<McpAppDisplayMode[]>();
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

    const display = presentation && {
      availableDisplayModes: availableDisplayModes({
        hostModes: presentation.hostModes,
        resourceMeta: resource?.meta as McpUiResourceMeta,
        appModes,
      }),
      containerDimensions:
        presentation.mode === 'fullscreen'
          ? dimensions
          : { width: dimensions.width, maxHeight: 2000 },
      displayMode: presentation.mode,
    };
    const lifecycle: AppViewContext['lifecycle'] = presentation && {
      getDisplayContext: () => display!,
      onInitialized: (appModes) => {
        setAppModes(appModes);
        const options = {
          appModes,
          hostModes: presentation.hostModes,
          resourceMeta: resource?.meta as McpUiResourceMeta,
          toolPreferred: presentation.preferred,
        };
        presentation.onInitialized(availableDisplayModes(options), resolveDisplayMode(options));
      },
      onRequestDisplayMode: (requested, appModes) => {
        const mode = requestedDisplayMode(presentation.mode, requested, {
          appModes,
          hostModes: presentation.hostModes,
          resourceMeta: resource?.meta as McpUiResourceMeta,
        });
        return presentation.onMode(mode);
      },
      onTeardown: presentation.onTeardown,
      onUpdateModelContext: presentation.onUpdateModelContext,
    };
    // Everything the bridge reads after mount goes through a ref, so the
    // iframe session is created once per document instead of per render.
    const latest = useLatest({
      agentId,
      args,
      display,
      lifecycle,
      presentation,
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
    // The session of the view now in the frame
    const sessionRef = useRef<AppViewSession>(undefined);

    useEffect(() => {
      const target = iframeRef.current?.contentWindow;
      if (!srcDoc || navigated || !target) return;

      const session = connectAppView({
        getContext: () => latest.current,
        onHeight: setHeight,
        onNavigated: () => setDroppedDoc(srcDoc),
        onWaitingApprovalsChange: (delta) => setWaitingApprovals((count) => count + delta),
        resourceUri,
        target,
        toolCallId,
      });
      sessionRef.current = session;
      bridgeRef.current = session.bridge;

      return () => {
        // A frame being removed was handed to `retireAppFrame`, which ends it
        if (sessionRef.current !== session) return;
        sessionRef.current = undefined;
        bridgeRef.current = undefined;
        session.dispose();
      };
    }, [latest, navigated, resourceUri, srcDoc, toolCallId]);

    // While the frame is about to be removed it still runs here (a layout
    // cleanup), so its view is told and given time to finish first
    const hasFrame = !!srcDoc && !navigated;
    useLayoutEffect(() => {
      if (!hasFrame) return;
      const frame = iframeRef.current;
      const retireOnRemove = latest.current.presentation?.retireOnRemove;
      const onDispose = latest.current.presentation?.onDispose;

      return () => {
        const session = sessionRef.current;
        if (!frame || !session) return;
        if (retireOnRemove && !retireOnRemove()) {
          session.dispose();
          sessionRef.current = undefined;
          bridgeRef.current = undefined;
          return;
        }
        onDispose?.();
        const retired = retireAppFrame(frame, {
          // Not removed after all: a session started since replaces this one
          keep: () => {
            if (sessionRef.current !== session) session.dispose();
          },
          teardown: session.teardown,
        });
        if (!retired) return;
        sessionRef.current = undefined;
        bridgeRef.current = undefined;
      };
    }, [hasFrame, latest]);

    const displaySignature = JSON.stringify(display);
    useEffect(() => {
      bridgeRef.current?.setHostContext(buildHostContext(isDark, latest.current.display));
    }, [isDark, displaySignature, latest]);

    useEffect(() => {
      const element = containerRef.current;
      if (!element) return;
      const observer = new ResizeObserver(([entry]) => {
        setDimensions({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        });
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, [srcDoc, navigated]);

    useEffect(() => {
      if (error) console.warn(`[MCPApp] failed to load ${resourceUri}:`, error);
    }, [error, resourceUri]);

    const phase = getAppViewPhase({ isLoading, navigated, srcDoc });
    if (phase === 'loading') return <Skeleton height={DEFAULT_HEIGHT} width={'100%'} />;
    if (phase === 'fallback') return fallback;

    return (
      <Flexbox
        gap={8}
        ref={containerRef}
        style={presentation?.mode === 'fullscreen' ? { height: '100%', minHeight: 0 } : undefined}
      >
        <div
          {...sx(
            resource?.meta?.prefersBorder !== false && styles.bordered,
            presentation?.mode === 'fullscreen' ? { flex: 1, minHeight: 0 } : {},
          )}
        >
          <iframe
            allow={APP_IFRAME_ALLOW}
            ref={iframeRef}
            // No `allow-same-origin`: the view runs on an opaque origin and can
            // reach LobeHub only through the postMessage bridge. The frame loads
            // the wrapper, which holds the view to its declared frame domains.
            sandbox={VIEW_FRAME_SANDBOX}
            srcDoc={srcDoc}
            title={`${identifier} / ${apiName}`}
            {...stylex.props(
              styles.iframe,
              styles.iframeHeight(presentation?.mode === 'fullscreen' ? '100%' : `${height}px`),
            )}
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
