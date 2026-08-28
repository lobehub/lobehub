'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment } from 'react';

import TaskItemSkeleton from '@/features/AgentTasks/AgentTaskList/TaskItemSkeleton';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

const TasksSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'}>
    {chrome !== 'body' && <NavHeader />}
    <WideScreenContainer
      fullWidth
      gap={16}
      paddingBlock={16}
      paddingInline={16}
      wrapperStyle={{ flex: 1, overflowY: 'auto' }}
    >
      <Block gap={2} padding={2} variant={'borderless'}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Fragment key={index}>
            <TaskItemSkeleton />
            {index !== 4 && <Divider dashed style={{ margin: 0 }} />}
          </Fragment>
        ))}
      </Block>
    </WideScreenContainer>
  </Flexbox>
);

export default TasksSkeleton;
