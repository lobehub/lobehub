'use client';

import type { AgentGroupMember, BuiltinInspectorProps } from '@lobechat/types';
import { safeParsePartialJSON } from '@lobechat/utils';
import { Avatar, cx, Flexbox, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar, { isDefaultAgentAvatar } from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { shinyTextStyles } from '@/styles';

import type { ExecuteTasksParams, TaskItem } from '../../../types';

const styles = stylex.create({
  root: { overflow: 'hidden', display: 'flex', gap: '8px', alignItems: 'center' },
  title: { flexShrink: 0, color: cssVar.colorTextSecondary, whiteSpace: 'nowrap' },
});

export const ExecuteAgentTasksInspector = memo<BuiltinInspectorProps<ExecuteTasksParams>>(
  ({ args, partialArgs, isArgumentsStreaming }) => {
    const { t } = useTranslation('plugin');

    // Handle case where LLM returns tasks as stringified JSON instead of array
    const tasks = useMemo(() => {
      const rawTasks = args?.tasks || partialArgs?.tasks;
      if (!rawTasks) return [];
      if (typeof rawTasks === 'string') {
        return safeParsePartialJSON<TaskItem[]>(rawTasks) || [];
      }
      return rawTasks;
    }, [args?.tasks, partialArgs?.tasks]);

    const agentIds = useMemo(() => {
      return tasks?.map((task) => task?.agentId)?.filter(Boolean);
    }, [tasks]);

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
          avatar: isDefaultAgentAvatar(agent.avatar) ? (
            <AgentAvatar agentId={agent.id} name={agent.title} size={24} />
          ) : (
            agent.avatar
          ),
          background: agent.backgroundColor || theme.colorBgContainer,
          key: agent.id,
          title: agent.title || undefined,
        })),
      [agents, theme.colorBgContainer],
    );

    if (isArgumentsStreaming && agents.length === 0) {
      return (
        <div {...stylex.props(styles.root)}>
          <span className={shinyTextStyles.shinyText}>
            {t('builtins.lobe-group-management.apiName.executeAgentTasks')}
          </span>
        </div>
      );
    }

    return (
      <Flexbox horizontal align={'center'} className={stylex.props(styles.root).className} gap={8}>
        <span
          className={cx(
            stylex.props(styles.title).className,
            isArgumentsStreaming && shinyTextStyles.shinyText,
          )}
        >
          {t('builtins.lobe-group-management.inspector.executeAgentTasks.title')}
        </span>
        {avatarItems.length > 0 && <Avatar.Group items={avatarItems} shape={'circle'} size={24} />}
      </Flexbox>
    );
  },
);
