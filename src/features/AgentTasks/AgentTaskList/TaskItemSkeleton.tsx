import { Block, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

interface TaskItemSkeletonProps {
  variant?: 'compact' | 'default';
}

const TaskItemSkeleton = memo<TaskItemSkeletonProps>(({ variant = 'default' }) => {
  if (variant === 'compact') {
    return (
      <Block gap={8} padding={12} variant={'borderless'}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Skeleton.Button active style={{ height: 14, minWidth: 60, width: 60 }} />
          <Skeleton.Avatar active shape={'circle'} size={'small'} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Skeleton.Avatar
            active
            shape={'square'}
            size={16}
            style={{ borderRadius: 4, flex: 'none' }}
          />
          <Skeleton.Button active block style={{ height: 16 }} />
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={8}>
          <Skeleton.Avatar
            active
            shape={'square'}
            size={14}
            style={{ borderRadius: 4, flex: 'none' }}
          />
          <Skeleton.Button active style={{ height: 12, minWidth: 48, width: 48 }} />
        </Flexbox>
      </Block>
    );
  }

  return (
    <Block gap={8} padding={12} variant={'borderless'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 1, minWidth: 0 }}>
          <Skeleton.Avatar
            active
            shape={'square'}
            size={16}
            style={{ borderRadius: 4, flex: 'none' }}
          />
          <Skeleton.Avatar
            active
            shape={'square'}
            size={16}
            style={{ borderRadius: 4, flex: 'none' }}
          />
          <Skeleton.Button active style={{ height: 14, minWidth: 64, width: 64 }} />
          <Skeleton.Button active style={{ height: 16, minWidth: 200, width: 200 }} />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
          <Skeleton.Avatar active shape={'circle'} size={'small'} />
          <Skeleton.Button active style={{ height: 12, minWidth: 40, width: 40 }} />
        </Flexbox>
      </Flexbox>
      <Skeleton.Button active style={{ height: 14, minWidth: 0, width: '60%' }} />
    </Block>
  );
});

TaskItemSkeleton.displayName = 'TaskItemSkeleton';

export default TaskItemSkeleton;
