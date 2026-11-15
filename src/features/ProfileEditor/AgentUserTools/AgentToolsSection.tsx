'use client';

import { getPluginMode, upsertPluginMode } from '@lobechat/types';
import { Button, confirmModal, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { CopyIcon, PlugZapIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { createAgentSkillStoreModal } from '@/features/AgentSkillStore';
import { type ItemDetail } from '@/features/ProfileEditor/ItemDetailPanel';
import PluginTag from '@/features/ProfileEditor/PluginTag';
import ToolListGroup, { type ToolGroupMeta } from '@/features/ProfileEditor/ToolListGroup';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';
import { useUserStore } from '@/store/user';

/**
 * The "Agent Tools" section (top of the tools area): the connectors owned by
 * this agent, rendered with the same chips as User Tools (PluginTag). Removing
 * an agent chip is a two-step op — unpin it from `agents.plugins` AND delete the
 * agent-owned `user_connectors` row (one more step than the user side).
 */
const AgentToolsSection = memo<{
  agentId: string;
  onStartCopy: () => void;
  /** The heading, description and action of the list; only the `list` variant shows them. */
  group?: ToolGroupMeta;
  /** Called with a connector's details when its row is clicked. */
  onOpenDetail?: (detail: ItemDetail) => void;
  /** `list` shows one row per tool as a settings group. */
  variant?: 'chip' | 'list';
}>(({ agentId, group, onOpenDetail, onStartCopy, variant = 'chip' }) => {
  const { t } = useTranslation('setting');
  const { allowed: canEdit } = usePermission('edit_own_content');

  // Deleting an agent connector row is creator-or-owner only in a workspace
  // (mirrors the server `assertWorkspaceRowManageable` gate). Used to hide the
  // remove (×) on shared connectors the current member can't delete, so B
  // never clicks into a FORBIDDEN error on A's connector.
  const activeWorkspaceId = useActiveWorkspaceId();
  const isWorkspaceOwner = useIsWorkspaceOwner();
  const currentUserId = useUserStore((s) => s.user?.id);

  const agentConnectors = useToolStore(connectorSelectors.agentConnectors(agentId), isEqual);
  const detachConnectorFromAgent = useToolStore((s) => s.detachConnectorFromAgent);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  const handleRemove = async (connector: ConnectorWithTools) => {
    const ok = await confirmModal({ content: t('settingAgent.agentTools.removeOwnedConfirm') });
    if (!ok) return;
    // 1) remove from agents.plugins, 2) delete the agent connector row.
    const config = agentSelectors.getAgentConfigById(agentId)(useAgentStore.getState());
    await updateAgentConfigById(agentId, {
      plugins: upsertPluginMode(config?.plugins, connector.identifier, 'auto'),
    });
    await detachConnectorFromAgent(connector.id, agentId, 'delete');
  };

  const addMenuItems = [
    {
      desc: t('settingAgent.agentTools.connectNew.desc'),
      icon: PlugZapIcon,
      key: 'connectNew',
      label: t('settingAgent.agentTools.connectNew.title'),
      onClick: () => createAgentSkillStoreModal(agentId),
    },
    {
      desc: t('settingAgent.agentTools.copy.desc'),
      icon: CopyIcon,
      key: 'copy',
      label: t('settingAgent.agentTools.copy.title'),
      onClick: onStartCopy,
    },
  ];

  const isList = variant === 'list';

  const addButton = (
    <DropdownMenu items={addMenuItems} placement={'bottomLeft'}>
      <Button disabled={!canEdit} icon={<Icon icon={PlusIcon} />} size={'small'} type={'text'}>
        {t('settingAgent.agentTools.add')}
      </Button>
    </DropdownMenu>
  );

  const agentPlugins = useAgentStore((s) => agentSelectors.getAgentConfigById(agentId)(s)?.plugins);
  const setEnabled = (identifier: string, enabled: boolean) =>
    updateAgentConfigById(agentId, {
      plugins: upsertPluginMode(agentPlugins, identifier, enabled ? 'pinned' : 'disabled'),
    });

  const tags = agentConnectors.map((connector) => {
    // Outside a workspace (personal), or when the row has no known
    // creator, fall back to the existing edit-permission gate. In a
    // workspace, only the creator or a workspace owner may delete.
    const canManageRow =
      !activeWorkspaceId ||
      !connector.userId ||
      connector.userId === currentUserId ||
      isWorkspaceOwner;
    return (
      <PluginTag
        agentId={agentId}
        disabled={!canEdit}
        enabled={getPluginMode(agentPlugins, connector.identifier) !== 'disabled'}
        key={connector.id}
        pluginId={connector.identifier}
        removable={canManageRow}
        showAuthor={!!activeWorkspaceId}
        variant={isList ? 'row' : 'chip'}
        onOpen={isList ? onOpenDetail : undefined}
        onToggle={isList ? (next) => void setEnabled(connector.identifier, next) : undefined}
        onRemove={() => {
          handleRemove(connector);
        }}
      />
    );
  });

  if (isList && group) {
    return (
      <ToolListGroup
        {...group}
        addControl={addButton}
        emptyText={t('settingAgent.agentTools.agentEmpty')}
        rows={tags}
        activeCount={
          agentConnectors.filter(
            (connector) => getPluginMode(agentPlugins, connector.identifier) !== 'disabled',
          ).length
        }
      />
    );
  }

  return (
    <Flexbox gap={8}>
      <Text style={{ fontSize: 12, fontWeight: 500 }} type={'secondary'}>
        {t('settingAgent.agentTools.tabAgent')} · {agentConnectors.length}
      </Text>
      <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
        {addButton}
        {agentConnectors.length === 0 && (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('settingAgent.agentTools.agentEmpty')}
          </Text>
        )}
        {tags}
      </Flexbox>
    </Flexbox>
  );
});

AgentToolsSection.displayName = 'AgentToolsSection';

export default AgentToolsSection;
