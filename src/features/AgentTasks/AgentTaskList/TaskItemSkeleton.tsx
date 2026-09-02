import { Block, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';

interface TaskItemSkeletonProps {
  variant?: 'compact' | 'default';
}

const TaskItemSkeleton = memo<TaskItemSkeletonProps>(({ variant = 'default' }) => {
  if (variant === 'compact') {
    return (
      <Block gap={8} padding={12} variant={'borderless'}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <SkeletonBar height={14} width={60} />
          <SkeletonBar height={20} radius={'50%'} width={20} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={16} radius={4} width={16} />
          <SkeletonBar height={16} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={14} radius={4} width={14} />
          <SkeletonBar height={12} width={48} />
        </Flexbox>
      </Block>
    );
  }

  return (
    <Block gap={8} padding={12} variant={'borderless'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 1, minWidth: 0 }}>
          <SkeletonBar height={16} radius={4} width={16} />
          <SkeletonBar height={16} radius={4} width={16} />
          <SkeletonBar height={14} width={64} />
          <SkeletonBar height={16} width={200} />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          <SkeletonBar height={20} radius={'50%'} width={20} />
          <SkeletonBar height={12} width={40} />
        </Flexbox>
      </Flexbox>
      <SkeletonBar height={14} width={'60%'} />
    </Block>
  );
});

TaskItemSkeleton.displayName = 'TaskItemSkeleton';

export default TaskItemSkeleton;
