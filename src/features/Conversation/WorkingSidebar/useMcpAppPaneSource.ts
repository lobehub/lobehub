import { useMcpAppIdentity } from '@/features/MCPApp/useMcpAppIdentity';
import { useToolResultPayload } from '@/hooks/useToolResultPayload';
import { canServeMcpAppHere, getMcpAppFromState } from '@/libs/mcp/mcpApp';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { electronGatewaySelectors } from '@/store/electron/selectors/gateway';
import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

/**
 * The tool result a side panel tab renders (`id` is its tool call), or
 * `undefined` when this conversation (`scope`) can't render it here.
 */
export const useMcpAppPaneSource = (id: string, scope: string) => {
  const view = useMcpAppStore(mcpAppSelectors.view(id));
  const host = useMcpAppStore(mcpAppSelectors.host(scope));
  // A tab restored with the conversation finds its result by the tool call,
  // in this conversation only, before any message has registered the view
  const messageId = useChatStore(
    (s) =>
      view?.messageId ??
      s.dbMessagesMap[scope]?.find((item) => item.role === 'tool' && item.tool_call_id === id)?.id,
  );
  const message = useChatStore(dbMessageSelectors.getDbMessageById(messageId ?? ''));
  const { payload } = useToolResultPayload(message?.id, message?.payloadOmitted === 'render');
  const currentDeviceId = useElectronStore(electronGatewaySelectors.gatewayStableDeviceId);
  const [title, icon] = useMcpAppIdentity(
    message?.plugin?.identifier ?? '',
    message?.agentId ?? host?.agentId,
  );
  const state = payload?.pluginState ?? message?.pluginState;
  const mcpApp = getMcpAppFromState(state);

  // A view stays with the conversation that produced it: another one (a thread
  // opened in the same topic) can't render it rather than taking it over
  if (
    (view && view.scope !== scope) ||
    !message?.plugin ||
    !mcpApp ||
    !canServeMcpAppHere(mcpApp, currentDeviceId)
  )
    return undefined;

  return {
    content: payload?.content ?? message.content,
    host,
    icon: view?.icon ?? icon,
    mcpApp,
    message: { ...message, plugin: message.plugin },
    state,
    title: view?.title ?? title,
  };
};
