'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { AgentGroupMember, BuiltinInspectorProps } from '@lobechat/types';
import { Avatar, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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
          avatar: agent.avatar || DEFAULT_AVATAR,
          background: agent.backgroundColor || theme.colorBgContainer,
          key: agent.id,
          title: agent.title || undefined,
        })),
      [agents],
    );

    if (isArgumentsStreaming && agents.length === 0) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-group-management.apiName.broadcast')}</span>
        </div>
      );
    }

    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.root, isArgumentsStreaming && shinyTextStyles.shinyText)}
        gap={8}
      >
        <span className={styles.title}>
          {t('builtins.lobe-group-management.inspector.broadcast.title')}
        </span>
        {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape={'circle'} size={24} />}
      </Flexbox>
    );
  },
);

BroadcastInspector.displayName = 'BroadcastInspector';

export default BroadcastInspector;
