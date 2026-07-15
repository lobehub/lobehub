'use client';

import { ActionIcon, Avatar, Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { McpIcon } from '@lobehub/ui/icons';
import { Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';
import type { AgentBoundConnector } from '@/store/tool/slices/connector/types';

import { styles } from './style';

/**
 * A row in the unified settings' "Agent Connectors" section (LOBE-11682): one
 * agent-owned connector, labelled with the owning agent's title, and deletable
 * in place. Deliberately flat (no detail panel): agent connectors can share an
 * identifier with a base connector, so identifier-keyed selection is ambiguous —
 * view + delete lives on the row instead.
 *
 * Delete removes only the connector row (see `deleteAgentConnector`); rebind /
 * pin migration is out of scope for this page (handled server-side elsewhere).
 */
const AgentConnectorItem = memo<{ connector: AgentBoundConnector }>(({ connector }) => {
  const { t } = useTranslation('setting');
  const deleteAgentConnector = useToolStore((s) => s.deleteAgentConnector);
  // 'copy' when the user also owns a same-identifier base connector, else 'agent'.
  const baseSame = useToolStore(connectorSelectors.connectorByIdentifier(connector.identifier));
  const canManage = useResourceManageable(connector.userId);
  const [deleting, setDeleting] = useState(false);

  const agentLabel = connector.agentTitle || t('skillGroup.agentConnectorsUnknownAgent', 'Agent');
  const badge = baseSame
    ? t('settingAgent.agentTools.badge.copy')
    : t('settingAgent.agentTools.badge.agentOnly');

  const handleDelete = async () => {
    const ok = await confirmModal({
      content: t('agentConnectorList.deleteConfirm'),
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteAgentConnector(connector.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Flexbox horizontal align="center" className={styles.container} gap={8} justify="space-between">
      <Flexbox horizontal align="center" gap={8} style={{ flex: 1, overflow: 'hidden' }}>
        <div className={styles.icon}>
          {connector.agentAvatar ? (
            <Avatar avatar={connector.agentAvatar} shape="square" size={16} />
          ) : (
            <Icon icon={McpIcon} size={16} />
          )}
        </div>
        <span className={styles.title} style={{ cursor: 'default' }}>
          {connector.name || connector.identifier}
        </span>
      </Flexbox>
      <Flexbox horizontal align="center" gap={4}>
        <Tag>
          {agentLabel} · {badge}
        </Tag>
        <Tooltip title={canManage ? undefined : t('agentConnectorList.manageOnlyCreator')}>
          <ActionIcon
            disabled={!canManage}
            icon={Trash2}
            loading={deleting}
            size="small"
            title={t('agentConnectorList.deleteTooltip')}
            onClick={canManage ? handleDelete : undefined}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
});

AgentConnectorItem.displayName = 'AgentConnectorItem';

export default AgentConnectorItem;
