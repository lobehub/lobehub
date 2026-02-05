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

import type { ExecuteTasksParams } from '../../../types';

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

export const ExecuteAgentTasksInspector = memo<BuiltinInspectorProps<ExecuteTasksParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    const tasks = args?.tasks || partialArgs?.tasks || [];
    const agentIds = useMemo(() => tasks.map((task) => task.agentId).filter(Boolean), [tasks]);

    // Get active group ID and agents from store
    const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
    const groupAgents = useAgentGroupStore((s) =>
      activeGroupId ? agentGroupSelectors.getGroupAgents(activeGroupId)(s) : [],
    );
    const theme = useTheme();

    // Get agent details for the task targets
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
      [agents, theme.colorBgContainer],
    );

    if (isArgumentsStreaming && agents.length === 0) {
      return (
        <div className={cx(styles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-group-management.apiName.executeAgentTasks')}</span>
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
          {t('builtins.lobe-group-management.inspector.executeAgentTasks.title')}
        </span>
        {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape={'circle'} size={24} />}
      </Flexbox>
    );
  },
);
