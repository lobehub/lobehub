import { Button, Flexbox, Text } from '@lobehub/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseMcpEntryTab } from '@/features/MCPApp/entrypoints';
import McpAppView from '@/features/MCPApp/McpAppView';
import { getAppToolCallPolicy } from '@/features/MCPApp/toolCallPolicy';
import { useMcpAppIdentity } from '@/features/MCPApp/useMcpAppIdentity';
import { getMcpAppFromState, unwrapMcpToolState } from '@/libs/mcp/mcpApp';
import { mcpService } from '@/services/mcp';
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
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Awaited<ReturnType<typeof mcpService.invokeMcpToolCall>>>();
  const [error, setError] = useState(false);
  const entry = parseMcpEntryTab(tab);
  const identifier = entry?.identifier;
  const toolName = entry?.toolName;
  const [title] = useMcpAppIdentity(identifier ?? '', agentId);
  const id = `${scope}:${tab}`;
  useEffect(() => {
    if (identifier) mcpAppActions.registerView(id, { identifier, scope, title });
  }, [id, identifier, scope, title]);
  useEffect(() => {
    if (!identifier || !toolName) return;
    const controller = new AbortController();
    void (async () => {
      const policy = await getAppToolCallPolicy(identifier, toolName, {
        agentId,
        fromEntrypoint: true,
      });
      if (policy === 'deny') throw new Error('This tool is unavailable');
      if (controller.signal.aborted) return;
      const response = await mcpService.invokeMcpToolCall(
        { id, identifier, apiName: toolName, arguments: '{}', type: 'mcp' },
        { agentId, fromEntrypoint: true, signal: controller.signal },
      );
      if (!getMcpAppFromState(response?.state) || !response?.success)
        throw new Error('No app resource');
      if (!controller.signal.aborted) setResult(response);
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => {
      controller.abort();
      mcpAppContext.clear(id);
    };
  }, [identifier, toolName, agentId, scope, id, attempt]);
  const app = getMcpAppFromState(result?.state);
  if (error || !entry)
    return (
      <Flexbox gap={8} padding={16}>
        <Text>{t('mcpApp.entrypoint.error')}</Text>
        <Button
          onClick={() => {
            setError(false);
            setResult(undefined);
            setAttempt((value) => value + 1);
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
          if (!modes.includes('fullscreen')) setError(true);
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
