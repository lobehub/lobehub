import { Button, Flexbox, Text } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseMcpEntryTab } from '@/features/MCPApp/entrypoints';
import McpAppView from '@/features/MCPApp/McpAppView';
import { useFetchMcpAppEntrypoint } from '@/features/MCPApp/useFetchMcpAppEntrypoint';
import { useMcpAppIdentity } from '@/features/MCPApp/useMcpAppIdentity';
import { getMcpAppFromState, unwrapMcpToolState } from '@/libs/mcp/mcpApp';
import { mcpAppActions } from '@/store/mcpApp/action';
import { mcpAppContext } from '@/store/mcpApp/context';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

export const McpEntryPane = ({
  tab,
  scope,
  agentId,
  onClose,
}: {
  tab: string;
  scope: string;
  agentId?: string;
  onClose: (tab: string) => void;
}) => {
  const { t } = useTranslation('plugin');
  const host = useMcpAppStore(mcpAppSelectors.host(scope));
  // The view declared no fullscreen mode, which an entrypoint always opens in
  const [unsupported, setUnsupported] = useState(false);
  const entry = parseMcpEntryTab(tab);
  const identifier = entry?.identifier;
  const toolName = entry?.toolName;
  const [title] = useMcpAppIdentity(identifier ?? '', agentId);
  const id = `${scope}:${tab}`;
  useEffect(() => {
    if (identifier) mcpAppActions.registerView(id, { identifier, scope, title });
  }, [id, identifier, scope, title]);
  const {
    data: result,
    error,
    mutate: reopen,
  } = useFetchMcpAppEntrypoint({ agentId, id, identifier, toolName });
  // Context the view reported belongs to this instance only
  useEffect(() => () => mcpAppContext.clear(id), [id]);
  const app = getMcpAppFromState(result?.state);
  if (error || unsupported || !entry)
    return (
      <Flexbox gap={8} padding={16}>
        <Text>{t('mcpApp.entrypoint.error')}</Text>
        <Button
          onClick={() => {
            setUnsupported(false);
            void reopen();
          }}
        >
          {t('mcpApp.entrypoint.retry')}
        </Button>
      </Flexbox>
    );
  if (!app || !result)
    return (
      <Flexbox padding={16}>
        <Text type={'secondary'}>{t('mcpApp.entrypoint.loading')}</Text>
      </Flexbox>
    );
  return (
    <McpAppView
      apiName={entry.toolName}
      arguments={'{}'}
      fallback={<Text>{t('mcpApp.entrypoint.error')}</Text>}
      identifier={entry.identifier}
      resourceUri={app.resourceUri}
      result={{ content: result.content, state: unwrapMcpToolState(result.state) }}
      server={app.server}
      toolCallId={id}
      host={{
        agentId,
        canSendMessage: !!host,
        sendMessage: async (params) => {
          if (host) await host.sendMessage(params);
        },
      }}
      presentation={{
        retireOnRemove: () => true,
        mode: 'fullscreen',
        hostModes: ['fullscreen'],
        onInitialized: (modes) => {
          if (!modes.includes('fullscreen')) setUnsupported(true);
        },
        onMode: () => 'fullscreen',
        onTeardown: () => onClose(tab),
        onUpdateModelContext: (params) => mcpAppContext.update(id, params),
        onDispose: () => mcpAppContext.clear(id),
      }}
      onThisDevice={!!app.deviceId}
    />
  );
};
