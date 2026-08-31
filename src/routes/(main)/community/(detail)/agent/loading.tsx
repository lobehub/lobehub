'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { useResponsive } from 'antd-style';
import { memo } from 'react';

import Nav from './features/Details/Nav';

const Loading = memo(() => {
  const { mobile } = useResponsive();
  return (
    <Flexbox gap={24}>
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={16} width={'100%'}>
          <Skeleton.Avatar shape={'square'} size={mobile ? 48 : 64} />
          <Skeleton height={36} width={200} />
        </Flexbox>
        <Skeleton height={28} width={200} />
      </Flexbox>
      <Nav />
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

export default Loading;
