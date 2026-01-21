'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { AgentGroupMember, BuiltinRenderProps } from '@lobechat/types';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { Clock } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-block: 12px;
  `,
  taskCard: css`
    padding: 12px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  taskContent: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorFillTertiary};
  `,
  taskHeader: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  timeout: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * ExecuteTasks Render component for Group Management tool
 * Read-only display of multiple task execution requests
 */
const ExecuteTasksRender = memo<BuiltinRenderProps<ExecuteTasksParams>>(({ args }) => {
  const { t } = useTranslation('tool');
  const theme = useTheme();
  const { tasks } = args || {};

  // Get active group ID and agents from store
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const groupAgents = useAgentGroupStore((s) =>
    activeGroupId ? agentGroupSelectors.getGroupAgents(activeGroupId)(s) : [],
  );

  // Get agent details for each task
  const tasksWithAgents = useMemo(() => {
    if (!tasks?.length || !groupAgents.length) return [];
    return tasks.map((task) => ({
      ...task,
      agent: groupAgents.find((agent) => agent.id === task.agentId) as AgentGroupMember | undefined,
    }));
  }, [tasks, groupAgents]);

  if (!tasksWithAgents.length) return null;

  return (
    <div className={styles.container}>
      {tasksWithAgents.map((task, index) => {
        const timeoutMinutes = task.timeout ? Math.round(task.timeout / 60_000) : 30;

        return (
          <div className={styles.taskCard} key={task.agentId || index}>
            <Flexbox gap={12}>
              {/* Header: Agent info + Timeout */}
              <Flexbox align={'center'} gap={12} horizontal justify={'space-between'}>
                <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ minWidth: 0 }}>
                  <Avatar
                    avatar={task.agent?.avatar || DEFAULT_AVATAR}
                    background={task.agent?.backgroundColor || theme.colorBgContainer}
                    shape={'square'}
                    size={20}
                  />
                  <span className={styles.taskHeader}>
                    {task.title || task.agent?.title || 'Task'}
                  </span>
                </Flexbox>
                <Flexbox align="center" className={styles.timeout} gap={4} horizontal>
                  <Clock size={14} />
                  <span>
                    {timeoutMinutes}{' '}
                    {t('agentGroupManagement.executeTask.intervention.timeoutUnit')}
                  </span>
                </Flexbox>
              </Flexbox>

              {/* Task content (read-only) */}
              {task.instruction && (
                <Text className={styles.taskContent} style={{ margin: 0 }}>
                  {task.instruction}
                </Text>
              )}
            </Flexbox>
          </div>
        );
      })}
    </div>
  );
});

ExecuteTasksRender.displayName = 'ExecuteTasksRender';

export default ExecuteTasksRender;
