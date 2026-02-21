'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import type { AgentGroupMember, BuiltinRenderProps } from '@lobechat/types';
import { Accordion, AccordionItem, Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo, useMemo } from 'react';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import type { ExecuteTasksParams } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  assignee: css`
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  container: css`
    .accordion-action {
      margin-inline-end: 8px;
      opacity: 1 !important;
    }
  `,
  index: css`
    flex-shrink: 0;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
  `,
  instruction: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,

  taskTitle: css`
    overflow: hidden;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

/**
 * ExecuteTasks Render component for Group Management tool
 * Accordion-style task list with expandable instruction and assignee on the right
 */
const ExecuteTasksRender = memo<BuiltinRenderProps<ExecuteTasksParams>>(({ args }) => {
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
    <Accordion className={styles.container} defaultExpandedKeys={[]} gap={0} variant={'borderless'}>
      {tasksWithAgents.map((task, index) => (
        <AccordionItem
          itemKey={task.agentId || String(index)}
          key={task.agentId || index}
          paddingBlock={8}
          paddingInline={4}
          action={
            <div className={styles.assignee}>
              <Avatar
                avatar={task.agent?.avatar || DEFAULT_AVATAR}
                background={task.agent?.backgroundColor || theme.colorBgContainer}
                shape={'circle'}
                size={20}
              />
              <span>{task.agent?.title}</span>
            </div>
          }
          title={
            <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
              <span className={styles.index}>{index + 1}.</span>
              <Text className={styles.taskTitle} weight={500}>
                {task.title || 'Task'}
              </Text>
            </Flexbox>
          }
        >
          {task.instruction && (
            <Block padding={12} style={{ marginTop: 8 }} variant={'filled'}>
              <Text className={styles.instruction}>{task.instruction}</Text>
            </Block>
          )}
        </AccordionItem>
      ))}
    </Accordion>
  );
});

ExecuteTasksRender.displayName = 'ExecuteTasksRender';

export default ExecuteTasksRender;
