'use client';

import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ArrowUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';

/**
 * Shown inside ConnectorDetail for agent-owned connectors (LOBE-11682), between
 * the description and the tool-permission list: which agent owns this connector,
 * plus a one-click jump to go use that agent.
 */
const AgentConnectorUsage = memo<{
  agentAvatar?: string | null;
  agentId: string;
  agentTitle?: string | null;
}>(({ agentId, agentTitle, agentAvatar }) => {
  const { t } = useTranslation('setting');
  const navigateToAgent = useNavigateToAgent();

  return (
    <Flexbox
      horizontal
      align="center"
      gap={12}
      justify="space-between"
      style={{
        background: 'var(--ant-color-fill-quaternary)',
        borderRadius: 8,
        marginBottom: 16,
        padding: '10px 12px',
      }}
    >
      <Flexbox horizontal align="center" gap={10} style={{ flex: 1, overflow: 'hidden' }}>
        <Avatar avatar={agentAvatar || undefined} size={32} title={agentTitle || undefined} />
        <Flexbox style={{ overflow: 'hidden' }}>
          <Text style={{ fontSize: 12 }} type="secondary">
            {t('agentConnectorUsage.label')}
          </Text>
          <Text ellipsis style={{ fontSize: 14, fontWeight: 500 }}>
            {agentTitle || t('skillGroup.agentConnectors')}
          </Text>
        </Flexbox>
      </Flexbox>
      <Button
        icon={<Icon icon={ArrowUpRight} size={14} />}
        size="small"
        onClick={() => navigateToAgent(agentId)}
      >
        {t('agentConnectorUsage.goToAgent')}
      </Button>
    </Flexbox>
  );
});

AgentConnectorUsage.displayName = 'AgentConnectorUsage';

export default AgentConnectorUsage;
