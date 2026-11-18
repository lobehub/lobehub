import { getBuiltinRender } from '@lobechat/builtin-tools/renders';
import { isDesktop } from '@lobechat/const';
import { type ChatPluginPayload } from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { useToolResultPayload } from '@/hooks/useToolResultPayload';
import {
  canServeMcpAppHere,
  getMcpAppFromState,
  getMcpUiFromState,
  unwrapMcpToolState,
} from '@/libs/mcp/mcpApp';
import dynamic from '@/libs/next/dynamic';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors/gateway';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { dataSelectors, useConversationStore } from '../../../../../store';
import CustomRender from './CustomRender';
import { FallbackArgumentRender } from './FallbacktArgumentRender';

const McpAppView = dynamic(() => import('./InlineMcpAppView').then((m) => m.InlineMcpAppView), {
  ssr: false,
});
const McpUiViews = dynamic(() => import('./InlineMcpUiViews').then((m) => m.InlineMcpUiViews), {
  ssr: false,
});

interface ToolRenderProps {
  content: string;
  messageId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;
  showCustomToolRender?: boolean;
  toolCallId: string;
}

const ToolRender = memo<ToolRenderProps>(
  ({ showCustomToolRender, content, messageId, plugin, pluginState, toolCallId }) => {
    const hasCustomRender = !!getBuiltinRender(plugin?.identifier, plugin?.apiName);
    const enableMcpApps = useServerConfigStore(serverConfigSelectors.enableMcpApps);
    const [currentDeviceId, useFetchGatewayStableDeviceId] = useElectronStore((s) => [
      electronGatewaySelectors.gatewayStableDeviceId(s),
      s.useFetchGatewayStableDeviceId,
    ]);

    // Tools whose card renders the stored body — the read path projected it away
    // and this component is where it comes back. Safe to fetch on mount: the
    // whole detail only mounts when the row is expanded, so a conversation load
    // asks for nothing.
    const needsStoredPayload = useConversationStore(
      (s) =>
        !!messageId && dataSelectors.getDbMessageById(messageId)(s)?.payloadOmitted === 'render',
    );
    const { isLoading, payload } = useToolResultPayload(messageId, needsStoredPayload);

    const resolvedContent = payload?.content ?? content;
    const resolvedState = payload?.pluginState ?? pluginState;

    // MCP Apps: the tool declared an interactive `ui://` view for its result
    const mcpApp = enableMcpApps ? getMcpAppFromState(resolvedState) : undefined;
    // MCP-UI: the result embeds its own `ui://` views
    const mcpUi = enableMcpApps ? getMcpUiFromState(resolvedState) : undefined;
    const viewDeviceId = mcpApp?.deviceId ?? mcpUi?.deviceId;
    // A view from a desktop's local MCP process: learn whether this is that desktop
    useFetchGatewayStableDeviceId(isDesktop && !!viewDeviceId);

    const resolvingDevice = isDesktop && !!viewDeviceId && currentDeviceId === undefined;
    if ((needsStoredPayload && isLoading && !payload) || resolvingDevice) {
      return (
        <Flexbox paddingBlock={8} width={'100%'}>
          <Skeleton height={96} width={'100%'} />
        </Flexbox>
      );
    }

    if (hasCustomRender && showCustomToolRender) {
      return (
        <CustomRender
          content={resolvedContent}
          messageId={messageId}
          plugin={plugin}
          pluginState={resolvedState}
          toolCallId={toolCallId}
        />
      );
    }

    const fallback = (
      <FallbackArgumentRender
        content={resolvedContent}
        identifier={plugin?.identifier}
        messageId={messageId}
        requestArgs={plugin?.arguments}
        toolCallId={toolCallId}
      />
    );

    // A view from another desktop's local MCP process would run here instead
    if (mcpApp && canServeMcpAppHere(mcpApp, currentDeviceId) && showCustomToolRender && plugin) {
      return (
        <McpAppView
          apiName={plugin.apiName}
          arguments={plugin.arguments}
          fallback={fallback}
          identifier={plugin.identifier}
          messageId={messageId}
          preferred={mcpApp.preferredModelDisplayMode}
          resourceUri={mcpApp.resourceUri}
          result={{ content: resolvedContent, state: unwrapMcpToolState(resolvedState) }}
          server={mcpApp.server}
          toolCallId={toolCallId}
          onThisDevice={!!mcpApp.deviceId}
        />
      );
    }

    if (mcpUi && canServeMcpAppHere(mcpUi, currentDeviceId) && showCustomToolRender && plugin) {
      return (
        <McpUiViews
          allowLoopbackHttp={!!mcpUi.local}
          apiName={plugin.apiName}
          arguments={plugin.arguments}
          fallback={fallback}
          identifier={plugin.identifier}
          messageId={messageId}
          resources={mcpUi.resources}
          result={{ content: resolvedContent, state: unwrapMcpToolState(resolvedState) }}
          server={mcpUi.server}
          toolCallId={toolCallId}
          onThisDevice={!!mcpUi.deviceId}
        />
      );
    }

    return fallback;
  },
);

ToolRender.displayName = 'ToolResultRender';

export default ToolRender;
