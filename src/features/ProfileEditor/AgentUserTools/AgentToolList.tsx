'use client';

import { upsertConnectorEnabled } from '@lobechat/types';
import { Button, type ItemType } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import AsyncBoundary from '@/components/AsyncBoundary';
import { createAgentSkillStoreModal } from '@/features/AgentSkillStore';
import ActionDropdown from '@/features/ChatInput/ActionBar/components/ActionDropdown';
import ToolItem from '@/features/ChatInput/ActionBar/Tools/ToolItem';
import { useControls } from '@/features/ChatInput/ActionBar/Tools/useControls';
import { createStore, Provider } from '@/features/ChatInput/store';
import { createSkillStoreModal } from '@/features/SkillStore';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';
import { useUserStore } from '@/store/user';

import type { AgentToolProps } from '../AgentTool';
import type { ItemConnection } from '../ItemDetailPanel';
import PluginTag from '../PluginTag';
import ProfilePopoverContent from '../PopoverContent';
import ToolListGroup, { type ToolGroupMeta } from '../ToolListGroup';
import { buildAgentToolRows, countAvailableTools } from './agentToolRows';
import CapabilitySettingsButton, { isConfigurableCapability } from './CapabilitySettingsButton';
import ConnectionMenu from './ConnectionMenu';
import { isAvailableLibraryConnection, isComposioConnection } from './useOwnConnection';

interface Props extends Pick<AgentToolProps, 'onOpenDetail'> {
  agentId: string;
  group: ToolGroupMeta;
}

const Tools = ({ agentId, group, onOpenDetail }: Props) => {
  const { t } = useTranslation('setting');
  const tools = useControls();
  const [open, setOpen] = useState(false);

  const activeWorkspaceId = useActiveWorkspaceId();
  const inWorkspace = !!activeWorkspaceId;
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore((s) => s.user?.id);
  const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);

  const isInit = useToolStore(connectorSelectors.isAgentConnectorsInit(agentId));
  const useFetchAgentConnectors = useToolStore((s) => s.useFetchAgentConnectors);
  const { error, isValidating, revalidate } = useFetchAgentConnectors(agentId);

  const agentConnectors = useToolStore(connectorSelectors.agentConnectors(agentId), isEqual);
  const libraryLoaded = useToolStore((s) => s.isConnectorsInit);
  const libraryConnectors = useToolStore(connectorSelectors.connectorList, isEqual);
  const config = useAgentStore(agentSelectors.getAgentConfigById(agentId));
  const plugins = config?.plugins;
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const rows = buildAgentToolRows({
    agentConnectors,
    agentId,
    chatConfig: config?.chatConfig,
    libraryOptions: tools.toolOptions,
    plugins,
  });

  // In a workspace a connection carries someone's credentials: only that member or an owner
  // may copy, replace or delete it. Everyone else sees the row without the choice.
  const canManage = (connector: ConnectorWithTools) =>
    tools.canEdit &&
    (!inWorkspace || !connector.userId || connector.userId === currentUserId || isWorkspaceOwner);

  /** The library's connection for a tool that signs in somewhere; nothing for other tools. */
  const libraryConnectionOf = (identifier: string) =>
    libraryConnectors.find(
      (c) =>
        c.identifier === identifier &&
        isAvailableLibraryConnection(c, agentId) &&
        (!isComposioConnection(c) || isComposioEnabled),
    );

  const ownConnectionNote: ItemConnection = {
    desc: t(
      inWorkspace
        ? 'settingAgent.tools.connection.ownDescWorkspace'
        : 'settingAgent.tools.connection.ownDesc',
    ),
    label: t('settingAgent.tools.connection.own'),
    title: t('settingAgent.tools.connection.ownTitle'),
  };
  const libraryConnectionNote: ItemConnection = {
    desc: t(
      inWorkspace
        ? 'settingAgent.tools.connection.workspaceDesc'
        : 'settingAgent.tools.connection.libraryDesc',
    ),
    title: t(
      inWorkspace
        ? 'settingAgent.tools.connection.workspaceTitle'
        : 'settingAgent.tools.connection.libraryTitle',
    ),
  };

  const setEnabled = (
    id: string,
    ownConnection: ConnectorWithTools | undefined,
    enabled: boolean,
  ) => {
    if (!ownConnection) return void tools.setPolicy(id, enabled ? 'auto' : 'disabled');
    // An agent's own connector stays independently switchable when the library needs authorization.
    void updateAgentConfigById(agentId, {
      plugins: upsertConnectorEnabled(plugins, id, enabled),
    });
  };

  const items: ItemType[] = (['lobehub', 'community', 'custom'] as const).flatMap((source) => {
    const children = tools.toolOptions
      .filter((tool) => tool.group === source)
      .map((tool) => ({
        key: tool.id,
        icon: tool.icon,
        searchText: tool.searchText,
        popoverContent: tool.detail,
        label: tool.connectionAction ?? (
          <ToolItem
            checked={tool.enabled}
            disabled={!tools.canEdit || !tool.canDisable}
            id={tool.id}
            label={tool.title}
            onUpdate={(id, enabled) => tools.setPolicy(id, enabled ? 'auto' : 'disabled')}
          />
        ),
      }));
    return children.length
      ? [{ children, key: source, label: t(`skillStore.tabs.${source}`), type: 'group' as const }]
      : [];
  });

  const list = (
    <ToolListGroup
      {...group}
      activeCount={rows.filter((row) => row.enabled).length}
      emptyText={t('settingAgent.toolsPage.group.empty')}
      fold={false}
      total={countAvailableTools(rows, tools.totalCount)}
      addControl={
        <ActionDropdown
          maxWidth={400}
          menu={{ items: [], style: { maxHeight: 'unset', overflowY: 'visible' } }}
          minWidth={400}
          open={open}
          placement="bottomLeft"
          popupProps={{ style: { padding: 0 } }}
          trigger="click"
          popupRender={() => (
            <ProfilePopoverContent
              toolsOnly
              items={items}
              onClose={() => setOpen(false)}
              onConnectForAgent={
                isComposioEnabled && tools.canEdit
                  ? () => {
                      setOpen(false);
                      createAgentSkillStoreModal(agentId);
                    }
                  : undefined
              }
              onOpenStore={() => {
                setOpen(false);
                createSkillStoreModal();
              }}
            />
          )}
          positionerProps={{
            collisionAvoidance: { align: 'flip', fallbackAxisSide: 'end', side: 'flip' },
            collisionBoundary:
              typeof document === 'undefined' ? undefined : document.documentElement,
            positionMethod: 'fixed',
          }}
          onOpenChange={setOpen}
        >
          <Button disabled={!tools.canEdit} icon={PlusIcon} size="small" type="text">
            {t('settingAgent.agentTools.add')}
          </Button>
        </ActionDropdown>
      }
      rows={rows.map(({ canDisable, enabled, id, inLibrary, ownConnection }) => {
        const libraryConnection = libraryConnectionOf(id);
        return (
          <PluginTag
            useAllMetaList
            agentId={agentId}
            disabled={!tools.canEdit || !canDisable}
            enabled={enabled}
            key={id}
            pluginId={id}
            removable={false}
            showAuthor={inWorkspace}
            variant="row"
            connection={
              ownConnection ? ownConnectionNote : libraryConnection && libraryConnectionNote
            }
            extra={
              isConfigurableCapability(id) ? (
                <CapabilitySettingsButton enabled={enabled} pluginId={id} />
              ) : (
                <ConnectionMenu
                  agentId={agentId}
                  fallbackConnectionId={inLibrary ? libraryConnection?.id : undefined}
                  libraryConnection={
                    !ownConnection &&
                    libraryConnection &&
                    !libraryConnection.metadata?.mountedByAgentId &&
                    canManage(libraryConnection)
                      ? libraryConnection
                      : undefined
                  }
                  ownConnection={
                    libraryLoaded && ownConnection && canManage(ownConnection)
                      ? ownConnection
                      : undefined
                  }
                />
              )
            }
            onOpen={onOpenDetail}
            onToggle={(on) => setEnabled(id, ownConnection, on)}
          />
        );
      })}
    />
  );
  return (
    <AsyncBoundary
      data={isInit || undefined}
      error={error}
      isLoading={isValidating}
      onRetry={revalidate}
    >
      {list}
    </AsyncBoundary>
  );
};

/**
 * Everything the agent can act with, as one list: a row per tool, its switch, and — for a
 * tool that signs in somewhere — whether the agent uses the library's connection or its own.
 *
 * The list and its nested search/memory settings must read and write the profile being
 * edited, even when another agent is open in the composer.
 */
const AgentToolList = ({ agentId, ...props }: Props) => (
  <Provider createStore={() => createStore({ agentId })} key={agentId}>
    <Tools agentId={agentId} {...props} />
  </Provider>
);

export default AgentToolList;
