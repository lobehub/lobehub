import { hasCallableMcpEndpoint } from '@lobechat/const';
import { getConnectorMode, upsertConnectorEnabled, upsertPluginMode } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { createAgentSkillStoreModal } from '@/features/AgentSkillStore';
import { useItemDetailStore } from '@/features/ProfileEditor/itemDetailStore';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { isLibraryConnectorForAgent } from '@/store/tool/slices/connector/selectors';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/** Where the library lists the agent's own connections, opened on one of them. */
export const ownConnectionSettingsPath = (connectorId: string) =>
  `/settings/connector?open=${encodeURIComponent(`agent-connector:${connectorId}`)}`;

/**
 * A Composio connection is an account held by Composio; a copy would point two connections at
 * that one account, and removing either would sign the other out. Its own connection is a
 * second account instead.
 */
export const isComposioConnection = (connector: ConnectorWithTools) =>
  !!connector.metadata && 'composio' in connector.metadata && !!connector.metadata.composio;

export const isAvailableLibraryConnection = (row: ConnectorWithTools, agentId: string) =>
  isLibraryConnectorForAgent(row, agentId) &&
  row.isEnabled &&
  row.status === 'connected' &&
  (isComposioConnection(row) || hasCallableMcpEndpoint(row));

/**
 * What an agent can do about the connection one of its tools runs on: get its own instead of
 * the library's, manage it, or give it up.
 */
export const useOwnConnection = (agentId: string) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const inWorkspace = !!useActiveWorkspaceId();
  const copyConnectorToAgent = useToolStore((s) => s.copyConnectorToAgent);
  const detachConnectorFromAgent = useToolStore((s) => s.detachConnectorFromAgent);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const readConfig = () => agentSelectors.getAgentConfigById(agentId)(useAgentStore.getState());

  // The side panel describes the connection as it was when the row was opened.
  const closeStaleDetail = (identifier: string) => {
    const { close, detail } = useItemDetailStore.getState();
    if (detail?.identifier === identifier) close();
  };

  /** Give the agent a connection of its own, starting from the library's. */
  const create = async (library: ConnectorWithTools) => {
    if (isComposioConnection(library)) {
      createAgentSkillStoreModal(agentId);
      return;
    }
    try {
      await copyConnectorToAgent(library.id, agentId);
      closeStaleDetail(library.identifier);
      toast.success({
        description: t('settingAgent.tools.connection.createdDesc'),
        title: t('settingAgent.tools.connection.created', { name: library.name }),
      });
    } catch (error) {
      console.error('[AgentTools] own connection failed:', error);
      toast.error(t('settingAgent.tools.connection.createFailed', { name: library.name }));
    }
  };

  const manage = (own: ConnectorWithTools) => navigate(ownConnectionSettingsPath(own.id));

  /** Drop the agent's own connection; the tool stays on and runs on the library's again. */
  const revertToLibrary = (own: ConnectorWithTools, fallbackConnectionId: string) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t(
        inWorkspace
          ? 'settingAgent.tools.connection.useWorkspaceConfirm.desc'
          : 'settingAgent.tools.connection.useLibraryConfirm.desc',
      ),
      okButtonProps: { danger: true },
      okText: t(
        inWorkspace
          ? 'settingAgent.tools.connection.useWorkspace'
          : 'settingAgent.tools.connection.useLibrary',
      ),
      onOk: async () => {
        // The library row may have been removed or mounted elsewhere while the dialog was open.
        const { fetchConnectors } = useToolStore.getState();
        try {
          await fetchConnectors();
        } catch {
          toast.error(t('settingAgent.tools.connection.switchFailed', { name: own.name }));
          return;
        }
        const fallback = useToolStore
          .getState()
          .connectors.find((row) => row.id === fallbackConnectionId);
        if (
          !fallback ||
          fallback.identifier !== own.identifier ||
          !isAvailableLibraryConnection(fallback, agentId)
        ) {
          toast.error(t('settingAgent.tools.connection.switchFailed', { name: own.name }));
          return;
        }

        const config = readConfig();
        const enabled =
          getConnectorMode(config?.plugins, own.identifier, config?.chatConfig) === 'auto';
        await detachConnectorFromAgent(own.id, agentId, 'delete');
        // Deleting an agent's connection also takes its tool off the agent. The tool is still
        // in the library, so put the switch back where it was.
        await updateAgentConfigById(agentId, {
          plugins: upsertConnectorEnabled(readConfig()?.plugins, own.identifier, enabled),
        });
        closeStaleDetail(own.identifier);
      },
      title: t('settingAgent.tools.connection.useLibraryConfirm.title', { name: own.name }),
    });

  /** Remove a tool only this agent has, together with its connection. */
  const remove = (own: ConnectorWithTools) =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('settingAgent.tools.connection.removeConfirm.desc'),
      okButtonProps: { danger: true },
      okText: t('settingAgent.tools.remove'),
      onOk: async () => {
        await updateAgentConfigById(agentId, {
          plugins: upsertPluginMode(readConfig()?.plugins, own.identifier, 'auto'),
        });
        await detachConnectorFromAgent(own.id, agentId, 'delete');
        closeStaleDetail(own.identifier);
      },
      title: t('settingAgent.tools.connection.removeConfirm.title', { name: own.name }),
    });

  return { create, manage, remove, revertToLibrary };
};
