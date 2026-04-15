import type { TaskDetailSubtask } from '@lobechat/types';
import { Block, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

const countSubtasks = (nodes: TaskDetailSubtask[]) => {
  let total = 0;
  let completed = 0;

  const walk = (list: TaskDetailSubtask[]) => {
    for (const node of list) {
      total++;
      if (node.status === 'completed') completed++;
      if (node.children && node.children.length > 0) walk(node.children);
    }
  };

  walk(nodes);
  return { completed, total };
};

interface TaskSubtaskProgressTagProps {
  subtasks?: TaskDetailSubtask[];
}

const TaskSubtaskProgressTag = memo<TaskSubtaskProgressTagProps>(({ subtasks }) => {
  const data = useMemo(() => {
    if (!subtasks || subtasks.length === 0) return undefined;

    const { completed, total } = countSubtasks(subtasks);
    if (total === 0) return undefined;

    return {
      text: `${completed}/${total}`,
      percent: (completed / total) * 100,
    };
  }, [subtasks]);

  if (!data) return null;

  return (
    <Block
      horizontal
      align={'center'}
      gap={4}
      height={24}
      paddingInline={'4px 8px'}
      style={{ borderRadius: 24 }}
      variant={'outlined'}
    >
      <Progress
        percent={data.percent}
        showInfo={false}
        size={16}
        strokeColor={cssVar.colorSuccess}
        type={'circle'}
      />
      <Text fontSize={12} type={'secondary'}>
        {data.text}
      </Text>
    </Block>
  );
});

export default TaskSubtaskProgressTag;
