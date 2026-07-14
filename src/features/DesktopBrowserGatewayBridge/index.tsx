'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { memo, useCallback } from 'react';

import { electronBrowserControlService } from '@/services/electron/browserControl';
import { invokeExecutor } from '@/store/tool/slices/builtin/executors';

const BROWSER_IDENTIFIER = 'lobe-browser';

/**
 * Desktop-only bridge for cloud-agent (gateway) browser tool calls.
 *
 * When an agent runs server-side, its browser tool calls are proxied back to
 * this device by the main process, which broadcasts `browserSidebarGatewayToolCall`.
 * Here we run the exact same client `browserExecutor` used for local runs (so
 * the mount / snapshot / click behavior has one source of truth) and report the
 * result back to the main process, keyed by requestId.
 */
const DesktopBrowserGatewayBridge = memo(() => {
  const handleToolCall = useCallback(
    async ({
      agentId,
      apiName,
      args,
      requestId,
    }: {
      agentId: string;
      apiName: string;
      args: Record<string, unknown>;
      requestId: string;
    }) => {
      try {
        const result = await invokeExecutor(BROWSER_IDENTIFIER, apiName, args, {
          agentId,
          messageId: `gateway-${requestId}`,
        });
        await electronBrowserControlService.reportGatewayToolResult({
          requestId,
          result: {
            content: result.content,
            error: result.error,
            state: result.state,
            success: result.success,
          },
        });
      } catch (error) {
        await electronBrowserControlService.reportGatewayToolResult({
          requestId,
          result: { content: (error as Error).message, success: false },
        });
      }
    },
    [],
  );

  useWatchBroadcast('browserSidebarGatewayToolCall', handleToolCall);

  return null;
});

DesktopBrowserGatewayBridge.displayName = 'DesktopBrowserGatewayBridge';

export default DesktopBrowserGatewayBridge;
