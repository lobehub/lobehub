'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { memo } from 'react';

const navSkeletonWidths = [88, 72, 82, 58];

const Loading = memo(() => (
  <Flexbox gap={24} width={'100%'}>
    <Flexbox horizontal align={'center'} gap={20} width={'100%'}>
      <Skeleton.Avatar shape={'square'} size={88} style={{ borderRadius: 22 }} />
      <Flexbox flex={1} gap={10}>
        <Skeleton height={28} width={240} />
        <Skeleton height={16} width={320} />
      </Flexbox>
    </Flexbox>
    <Skeleton height={78} radius={16} />
    <Flexbox horizontal gap={24} style={{ borderBottom: '1px solid transparent' }}>
      {navSkeletonWidths.map((width, i) => (
        <Skeleton height={40} key={i} width={width} />
      ))}
    </Flexbox>
    <Flexbox gap={8}>
      <Skeleton height={18} />
      <Skeleton height={18} />
      <Skeleton height={18} width={'78%'} />
    </Flexbox>
    <Skeleton height={320} radius={8} />
  </Flexbox>
));

export default Loading;
