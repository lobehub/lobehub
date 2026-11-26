import { Button, Flexbox, Text } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mcpEntryInstanceId, parseMcpEntryTab } from '@/features/MCPApp/entrypoints';
import McpAppView from '@/features/MCPApp/McpAppView';
import { openMcpAppEntrypoint } from '@/features/MCPApp/openEntrypoint';
import { useMcpAppIdentity } from '@/features/MCPApp/useMcpAppIdentity';
import { getMcpAppFromState, unwrapMcpToolState } from '@/libs/mcp/mcpApp';
import { mcpAppActions } from '@/store/mcpApp/action';
import { mcpAppContext } from '@/store/mcpApp/context';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

export const McpEntryPane = ({
  tab,
  scope,
  agentId,
  topicId,
  onClose,
}: {
  tab: string;
  scope: string;
  agentId?: string;
  /** The conversation the app runs in: its calls and resources resolve there. */
  topicId?: string;
  onClose: (tab: string) => void;
}) => {
  const { t } = useTranslation('plugin');
  const host = useMcpAppStore(mcpAppSelectors.host(scope));
  // The view declared no fullscreen mode, which an entrypoint always opens in
  const [unsupported, setUnsupported] = useState(false);
  const entry = parseMcpEntryTab(tab);
  const identifier = entry?.identifier;
  const toolName = entry?.toolName;
  const linkId = entry?.linkId;
  const [title] = useMcpAppIdentity(identifier ?? '', agentId);
  const id = mcpEntryInstanceId(scope, tab);
  useEffect(() => {
    if (identifier) mcpAppActions.registerView(id, { identifier, scope, title });
  }, [id, identifier, scope, title]);
  // Opened by the user (the open menu, or the buttons below), never by mounting
  const state = useMcpAppStore(mcpAppSelectors.entry(id));
  const open = () => {
    setUnsupported(false);
    if (identifier && toolName)
      void openMcpAppEntrypoint({ agentId, id, identifier, linkId, toolName, topicId });
  };
  // Context the view reported belongs to this instance only
  useEffect(() => () => mcpAppContext.clear(id), [id]);
  const result = state?.result;
  const app = getMcpAppFromState(result?.state);
  if (state?.status === 'error' || unsupported || !entry)
    return (
      <Flexbox gap={8} padding={16}>
        <Text>{t('mcpApp.entrypoint.error')}</Text>
        <Button onClick={open}>{t('mcpApp.entrypoint.retry')}</Button>
      </Flexbox>
    );
  // A tab restored with the conversation: its app opens when the user asks
  if (!state)
    return (
      <Flexbox align={'flex-start'} gap={8} padding={16}>
        <Text type={'secondary'}>{title}</Text>
        <Button onClick={open}>{t('mcpApp.entrypoint.open')}</Button>
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
      linkId={linkId}
      resourceUri={app.resourceUri}
      result={{ content: result.content, state: unwrapMcpToolState(result.state) }}
      server={app.server}
      toolCallId={id}
      host={{
        agentId,
        topicId,
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
        // Only this open's app closes the tab: an older one that finishes
        // saving after the tab was closed and reopened must not close the new one
        onTeardown: () => {
          if (mcpAppActions.isCurrentEntry(id, state?.request)) onClose(tab);
        },
        onUpdateModelContext: (params) => mcpAppContext.update(id, params),
        onDispose: () => mcpAppContext.clear(id),
      }}
      onThisDevice={!!app.deviceId}
    />
  );
};
