'use client';

import { AccordionItem, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { EXECUTION_STATUS_VISUALS, type ExecutionStatusVisual } from '@/components/ExecutionStatus';
import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

import TaskItem from './TaskItem';

const STATUS_META: Record<string, ExecutionStatusVisual & { titleKey: string }> = {
  backlog: { ...EXECUTION_STATUS_VISUALS.backlog, titleKey: 'taskList.kanban.backlog' },
  needsInput: {
    ...EXECUTION_STATUS_VISUALS.waitingForHuman,
    titleKey: 'taskList.kanban.needsInput',
  },
  running: { ...EXECUTION_STATUS_VISUALS.running, titleKey: 'taskList.kanban.running' },
};

interface StatusGroupProps {
  group: TaskGroupItem;
}

const StatusGroup = memo<StatusGroupProps>(({ group }) => {
  const { t } = useTranslation('chat');
  const { taskId } = useParams<{ taskId?: string }>();
  const meta = STATUS_META[group.key];
  if (!meta) return null;

  return (
    <AccordionItem
      itemKey={group.key}
      paddingBlock={4}
      paddingInline={4}
      title={
        <Flexbox horizontal align="center" gap={8} height={24} style={{ overflow: 'hidden' }}>
          <Center flex={'none'} height={24} width={24}>
            <Icon color={meta.color} icon={meta.icon} size={{ size: 14, strokeWidth: 1.75 }} />
          </Center>
          <Text ellipsis fontSize={13} style={{ color: cssVar.colorTextSecondary, flex: 1 }}>
            {t(meta.titleKey as 'taskList.kanban.backlog')}
          </Text>
          <Text fontSize={11} type="secondary">
            {group.tasks.length}
          </Text>
        </Flexbox>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        {group.tasks.map((task) => (
          <TaskItem
            active={taskId === task.identifier || taskId === task.id}
            key={task.id}
            task={task}
          />
        ))}
      </Flexbox>
    </AccordionItem>
  );
});

export default StatusGroup;
