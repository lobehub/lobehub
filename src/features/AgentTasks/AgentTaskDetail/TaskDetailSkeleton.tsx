'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import { taskDetailLayoutStyles as layout } from './taskDetailLayoutStyles';

const styles = stylex.create({
  acceptance: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  divider: {
    width: '100%',
    height: '1px',
    backgroundColor: cssVar.colorBorderSecondary,
    backgroundImage: 'none',
  },
  control: {
    height: '32px',
    paddingInline: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
});

const TaskDetailBodySkeleton = () => (
  <Flexbox aria-busy className={stylex.props(layout.root).className} flex={1}>
    <div className={stylex.props(layout.header).className}>
      <Flexbox className={stylex.props(layout.main).className} gap={12}>
        <Flexbox style={{ paddingBottom: 5, paddingTop: 5 }}>
          <SkeletonBar height={24} width={'min(520px, 56%)'} />
        </Flexbox>
        <Flexbox horizontal gap={8} wrap={'wrap'}>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.control).className}
            gap={8}
            width={76}
          >
            <SkeletonBar height={12} radius={3} width={12} />
            <SkeletonBar height={10} width={36} />
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.control).className}
            gap={8}
            width={96}
          >
            <SkeletonBar height={16} radius={'50%'} width={16} />
            <SkeletonBar height={10} width={48} />
          </Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.control).className}
            gap={8}
            width={176}
          >
            <SkeletonBar height={16} radius={'50%'} width={16} />
            <SkeletonBar height={10} width={116} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <div className={stylex.props(layout.side).className}>
        <div className={stylex.props(layout.properties).className}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(layout.propertyItem).className}
              gap={8}
              key={index}
            >
              <SkeletonBar height={16} radius={4} width={16} />
              <SkeletonBar height={14} width={index === 1 ? 80 : 68} />
            </Flexbox>
          ))}
        </div>
      </div>
    </div>

    <Flexbox gap={24} style={{ paddingBottom: 120 }}>
      <Flexbox gap={12}>
        <SkeletonBar height={14} width={'94%'} />
        <SkeletonBar height={14} width={'88%'} />
        <SkeletonBar height={14} width={'72%'} />
      </Flexbox>

      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8}>
          <SkeletonBar height={16} radius={'50%'} width={16} />
          <SkeletonBar height={18} width={112} />
        </Flexbox>
        <Flexbox className={stylex.props(styles.acceptance).className}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox key={index}>
              {index > 0 && <div {...stylex.props(styles.divider)} />}
              <Flexbox horizontal align={'center'} gap={10} padding={'12px'}>
                <SkeletonBar height={16} radius={'50%'} width={16} />
                <SkeletonBar height={12} width={24} />
                <SkeletonBar height={14} width={`${58 + index * 9}%`} />
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  </Flexbox>
);

const TaskDetailSkeleton = memo<RouteSkeletonProps>(({ chrome = 'page' }) =>
  chrome === 'body' ? (
    <TaskDetailBodySkeleton />
  ) : (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox flex={1} style={{ minHeight: 0, overflowY: 'auto' }}>
        <WideScreenContainer>
          <TaskDetailBodySkeleton />
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  ),
);

TaskDetailSkeleton.displayName = 'TaskDetailSkeleton';

export default TaskDetailSkeleton;
