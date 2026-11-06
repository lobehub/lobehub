import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { ManagedMcpAppView } from '@/features/MCPApp/ManagedMcpAppView';
import { useToolResultPayload } from '@/hooks/useToolResultPayload';
import { canServeMcpAppHere, getMcpAppFromState, unwrapMcpToolState } from '@/libs/mcp/mcpApp';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors/gateway';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

export const McpAppTabLabel = ({ id }: { id: string }) => {
  const view = useMcpAppStore(mcpAppSelectors.view(id));
  return <>{view?.title ?? 'App'}</>;
};

export const McpAppPane = ({ id, scope }: { id: string; scope: string }) => {
  const { t } = useTranslation('plugin');
  const view = useMcpAppStore(mcpAppSelectors.view(id));
  const host = useMcpAppStore(mcpAppSelectors.host(scope));
  const message = useChatStore(dbMessageSelectors.getDbMessageById(view?.messageId ?? ''));
  const { payload } = useToolResultPayload(message?.id, message?.payloadOmitted === 'render');
  const currentDeviceId = useElectronStore(electronGatewaySelectors.gatewayStableDeviceId);
  const state = payload?.pluginState ?? message?.pluginState;
  const mcpApp = getMcpAppFromState(state);
  if (!view || !message?.plugin || !mcpApp || !canServeMcpAppHere(mcpApp, currentDeviceId))
    return <Text type={'secondary'}>{t('mcpApp.panel.unavailable')}</Text>;
  return (
    <ManagedMcpAppView
      apiName={message.plugin.apiName}
      arguments={message.plugin.arguments}
      fallback={<Text>{message.content}</Text>}
      identifier={message.plugin.identifier}
      location={'fullscreen'}
      messageId={message.id}
      preferred={mcpApp.preferredModelDisplayMode}
      resourceUri={mcpApp.resourceUri}
      result={{ content: payload?.content ?? message.content, state: unwrapMcpToolState(state) }}
      scope={scope}
      server={mcpApp.server}
      toolCallId={id}
      host={{
        agentId: message.agentId ?? host?.agentId,
        canSendMessage: !!host,
        sendMessage: async (params) => {
          if (!host) throw new Error('No writable conversation');
          await host.sendMessage(params);
        },
      }}
      onThisDevice={!!mcpApp.deviceId}
    />
  );
};
