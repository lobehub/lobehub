'use client';

import type { AgentGroupMember, BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox, Markdown, useTheme } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import AgentAvatar from '@/components/AgentAvatar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams } from '../../../types';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  instruction: { fontSize: '13px', color: cssVar.colorTextSecondary },
  taskCard: {
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  taskTitle: { fontSize: '13px', fontWeight: 500, color: cssVar.colorText },
});

export const ExecuteTasksStreaming = memo<BuiltinStreamingProps<ExecuteTasksParams>>(({ args }) => {
  const { tasks } = args || {};
  const theme = useTheme();

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
    <div {...stylex.props(styles.container)}>
      {tasksWithAgents.map((task, index) => (
        <div {...stylex.props(styles.taskCard)} key={task.agentId || index}>
          <Flexbox gap={8}>
            <Flexbox horizontal align={'center'} gap={8}>
              <AgentAvatar
                agentId={task.agentId}
                avatar={task.agent?.avatar}
                background={task.agent?.backgroundColor || theme.colorBgContainer}
                name={task.agent?.title}
                shape={'square'}
                size={20}
              />
              <span {...stylex.props(styles.taskTitle)}>
                {task.title || task.agent?.title || 'Task'}
              </span>
            </Flexbox>
            {task.instruction && (
              <div {...stylex.props(styles.instruction)}>
                <Markdown animated variant={'chat'}>
                  {task.instruction}
                </Markdown>
              </div>
            )}
          </Flexbox>
        </div>
      ))}
    </div>
  );
});

ExecuteTasksStreaming.displayName = 'ExecuteTasksStreaming';

export default ExecuteTasksStreaming;
