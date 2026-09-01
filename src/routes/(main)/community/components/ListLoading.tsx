'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { cssVar, useResponsive } from 'antd-style';
import { memo } from 'react';

import {
  ArticleSkeleton,
  CommunityListSkeleton,
  type CommunityListSkeletonProps,
} from '@/components/Skeleton';

const ListLoading = memo<CommunityListSkeletonProps>((props) => (
  <CommunityListSkeleton chrome={'body'} {...props} />
));

export const DetailsLoading = memo(() => {
  const { mobile } = useResponsive();
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        {!mobile && <ArticleSkeleton rows={1} style={{ width: 200 }} title={false} />}
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar size={mobile ? 48 : 64} />
          <Skeleton height={36} width={200} />
        </Flexbox>
        <Skeleton height={28} width={200} />
      </Flexbox>
      <Flexbox
        horizontal
        gap={12}
        height={54}
        style={{
          borderBottom: `1px solid ${cssVar.colorBorder}`,
        }}
      >
        <Skeleton height={36} />
        <Skeleton height={36} />
      </Flexbox>
      <Flexbox
        gap={48}
        horizontal={!mobile}
        style={mobile ? { flexDirection: 'column-reverse' } : undefined}
      >
        <Flexbox
          flex={1}
          gap={16}
          width={'100%'}
          style={{
            overflow: 'hidden',
          }}
        >
          <Skeleton.Text rows={3} />
          <Skeleton.Text rows={8} />
          <Skeleton.Text rows={8} />
        </Flexbox>
        <Flexbox gap={16} width={360}>
          <Skeleton.Text rows={3} />
          <Skeleton.Text rows={4} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});
export default ListLoading;
