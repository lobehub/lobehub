'use client';

import type { AgentGroupMember, BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, createStaticStyles, cx, Flexbox, useTheme } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar, { isDefaultAgentAvatar } from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { shinyTextStyles } from '@/styles';

import type { BroadcastParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
  `,
  title: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

export const BroadcastInspector = memo<BuiltinInspectorProps<BroadcastParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const agentIds = args?.agentIds || partialArgs?.agentIds || [];

    // Get active group ID and agents from store
    const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
    const groupAgents = useAgentGroupStore((s) =>
      activeGroupId ? agentGroupSelectors.getGroupAgents(activeGroupId)(s) : [],
    );
    const theme = useTheme();

    // Get agent details for the broadcast targets
    const agents = useMemo(() => {
      if (!agentIds.length || !groupAgents.length) return [];
      return agentIds
        .map((id) => groupAgents.find((agent) => agent.id === id))
        .filter((agent): agent is AgentGroupMember => !!agent);
    }, [agentIds, groupAgents]);

    // Transform agents to Avatar.Group format
    const avatarItems = useMemo(
      () =>
        agents.map((agent) => ({
          avatar: isDefaultAgentAvatar(agent.avatar) ? (
            <AgentAvatar agentId={agent.id} name={agent.title} size={24} />
          ) : (
            agent.avatar
          ),
          background: agent.backgroundColor || theme.colorBgContainer,
          key: agent.id,
          title: agent.title || undefined,
        })),
      [agents],
    );

    if (isArgumentsStreaming && agents.length === 0) {
      return (
        <div className={styles.root}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-group-management.apiName.broadcast')}
          </span>
        </div>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={styles.root} gap={8}>
        <span className={cx(styles.title, isArgumentsStreaming && shinyTextStyles.shinyText)}>
          {t('builtins.lobe-group-management.inspector.broadcast.title')}
        </span>
        {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape={'circle'} size={24} />}
      </Flexbox>
    );
  },
);

BroadcastInspector.displayName = 'BroadcastInspector';

export default BroadcastInspector;
