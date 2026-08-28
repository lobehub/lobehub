'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';

const styles = createStaticStyles(({ css }) => ({
  acceptance: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  divider: css`
    width: 100%;
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  control: css`
    height: 32px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  propertyCard: css`
    flex: none;

    width: 200px;
    height: 108px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

const TaskDetailSkeleton = memo(() => (
  <Flexbox aria-busy flex={1}>
    <Flexbox gap={4} style={{ paddingBlock: '24px 44px' }}>
      <Flexbox style={{ paddingBottom: 33, paddingTop: 5 }}>
        <SkeletonBar height={24} width={'min(520px, 56%)'} />
      </Flexbox>
      <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <Flexbox align={'flex-start'} flex={1} gap={16} style={{ minWidth: 240 }}>
          <Flexbox horizontal gap={8} wrap={'wrap'}>
            <Flexbox horizontal align={'center'} className={styles.control} gap={8} width={96}>
              <SkeletonBar height={16} radius={'50%'} width={16} />
              <SkeletonBar height={10} width={48} />
            </Flexbox>
            <Flexbox horizontal align={'center'} className={styles.control} gap={8} width={176}>
              <SkeletonBar height={16} radius={'50%'} width={16} />
              <SkeletonBar height={10} width={116} />
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} className={styles.control} gap={8} width={76}>
            <SkeletonBar height={12} radius={3} width={12} />
            <SkeletonBar height={10} width={36} />
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.propertyCard} gap={8}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox horizontal align={'center'} gap={10} key={index}>
              <SkeletonBar height={16} radius={4} width={16} />
              <SkeletonBar height={14} width={index === 1 ? 80 : 68} />
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>
    </Flexbox>

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
        <Flexbox className={styles.acceptance}>
          {Array.from({ length: 3 }).map((_, index) => (
            <Flexbox key={index}>
              {index > 0 && <div className={styles.divider} />}
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
));

TaskDetailSkeleton.displayName = 'TaskDetailSkeleton';

export default TaskDetailSkeleton;
