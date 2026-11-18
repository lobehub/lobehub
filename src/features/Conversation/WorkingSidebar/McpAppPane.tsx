import { Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { ManagedMcpAppView } from '@/features/MCPApp/ManagedMcpAppView';
import { unwrapMcpToolState } from '@/libs/mcp/mcpApp';

import { useMcpAppPaneSource } from './useMcpAppPaneSource';

export const McpAppPane = ({ id, scope }: { id: string; scope: string }) => {
  const { t } = useTranslation('plugin');
  const source = useMcpAppPaneSource(id, scope);
  if (!source) return <Text type={'secondary'}>{t('mcpApp.panel.unavailable')}</Text>;

  const { content, host, icon, mcpApp, message, state, title } = source;
  return (
    <ManagedMcpAppView
      apiName={message.plugin.apiName}
      arguments={message.plugin.arguments}
      fallback={<Text>{message.content}</Text>}
      icon={icon}
      identifier={message.plugin.identifier}
      location={'fullscreen'}
      messageId={message.id}
      preferred={mcpApp.preferredModelDisplayMode}
      resourceUri={mcpApp.resourceUri}
      result={{ content, state: unwrapMcpToolState(state) }}
      scope={scope}
      server={mcpApp.server}
      title={title}
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
