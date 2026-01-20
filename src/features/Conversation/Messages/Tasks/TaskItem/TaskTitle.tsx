'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ListChecksIcon, XIcon } from 'lucide-react';
import { memo } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { ThreadStatus } from '@/types/index';

import { isProcessingStatus } from '../shared';

interface TaskTitleProps {
  status?: ThreadStatus;
  title?: string;
}

const TaskStatusIndicator = memo<{ status?: ThreadStatus }>(({ status }) => {
  const isCompleted = status === ThreadStatus.Completed;
  const isError = status === ThreadStatus.Failed || status === ThreadStatus.Cancel;
  const isProcessing = status ? isProcessingStatus(status) : false;
  const isInitializing = !status;

  let icon;

  if (isCompleted) {
    icon = <Icon color={cssVar.colorSuccess} icon={ListChecksIcon} />;
  } else if (isError) {
    icon = <Icon color={cssVar.colorError} icon={XIcon} />;
  } else if (isProcessing || isInitializing) {
    icon = <NeuralNetworkLoading size={16} />;
  } else {
    return null;
  }

  return (
    <Block
      align={'center'}
      flex={'none'}
      gap={4}
      height={24}
      horizontal
      justify={'center'}
      style={{
        fontSize: 12,
      }}
      variant={'outlined'}
      width={24}
    >
      {icon}
    </Block>
  );
});

TaskStatusIndicator.displayName = 'TaskStatusIndicator';

const TaskTitle = memo<TaskTitleProps>(({ title, status }) => {
  return (
    <Flexbox align={'center'} gap={6} horizontal>
      <TaskStatusIndicator status={status} />
      <Text ellipsis fontSize={14}>
        {title}
      </Text>
    </Flexbox>
  );
});

TaskTitle.displayName = 'TaskTitle';

export default TaskTitle;
