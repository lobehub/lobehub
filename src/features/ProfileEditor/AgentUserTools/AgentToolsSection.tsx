'use client';

import { upsertPluginMode } from '@lobechat/types';
import { Dropdown, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { CopyIcon, PlugZapIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { createAgentSkillStoreModal } from '@/features/AgentSkillStore';
import PluginTag from '@/features/ProfileEditor/PluginTag';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * The "Agent Tools" section (top of the tools area): the connectors owned by
 * this agent, rendered with the same chips as User Tools (PluginTag). Removing
 * an agent chip is a two-step op — unpin it from `agents.plugins` AND delete the
 * agent-owned `user_connectors` row (one more step than the user side).
 */
const AgentToolsSection = memo<{ agentId: string; onStartCopy: () => void }>(
  ({ agentId, onStartCopy }) => {
    const { t } = useTranslation('setting');
    const { allowed: canEdit } = usePermission('edit_own_content');

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
        icon: <Icon icon={PlugZapIcon} />,
        key: 'connectNew',
        label: (
          <Flexbox>
            <Text>{t('settingAgent.agentTools.connectNew.title')}</Text>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('settingAgent.agentTools.connectNew.desc')}
            </Text>
          </Flexbox>
        ),
        onClick: () => createAgentSkillStoreModal(agentId),
      },
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copy',
        label: (
          <Flexbox>
            <Text>{t('settingAgent.agentTools.copy.title')}</Text>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('settingAgent.agentTools.copy.desc')}
            </Text>
          </Flexbox>
        ),
        onClick: onStartCopy,
      },
    ];

    return (
      <Flexbox gap={8}>
        <Text style={{ fontSize: 12, fontWeight: 500 }} type={'secondary'}>
          {t('settingAgent.agentTools.tabAgent')} · {agentConnectors.length}
        </Text>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Dropdown
            disabled={!canEdit}
            menu={{ items: addMenuItems }}
            placement={'bottomLeft'}
            trigger={['click']}
          >
            <Button icon={<Icon icon={PlusIcon} />} size={'small'} type={'text'}>
              {t('settingAgent.agentTools.add')}
            </Button>
          </Dropdown>

          {agentConnectors.length === 0 && (
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('settingAgent.agentTools.agentEmpty')}
            </Text>
          )}

          {agentConnectors.map((connector) => (
            <PluginTag
              agentId={agentId}
              disabled={!canEdit}
              key={connector.id}
              pluginId={connector.identifier}
              onRemove={() => {
                handleRemove(connector);
              }}
            />
          ))}
        </Flexbox>
      </Flexbox>
    );
  },
);

AgentToolsSection.displayName = 'AgentToolsSection';

export default AgentToolsSection;
