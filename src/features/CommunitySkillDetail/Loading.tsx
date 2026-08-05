'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

const navSkeletonWidths = [88, 72, 82, 58];

const Loading = memo(() => (
  <Flexbox gap={24} width={'100%'}>
    <Flexbox horizontal align={'center'} gap={20} width={'100%'}>
      <Skeleton.Avatar active shape={'square'} size={88} style={{ borderRadius: 22 }} />
      <Flexbox flex={1} gap={10}>
        <Skeleton.Button active style={{ height: 28, width: 240 }} />
        <Skeleton.Button active style={{ height: 16, width: 320 }} />
      </Flexbox>
    </Flexbox>
    <Skeleton.Button active block style={{ borderRadius: 16, height: 78 }} />
    <Flexbox horizontal gap={24} style={{ borderBottom: '1px solid transparent' }}>
      {navSkeletonWidths.map((width, i) => (
        <Skeleton.Button active key={i} style={{ height: 40, width }} />
      ))}
    </Flexbox>
    <Flexbox gap={8}>
      <Skeleton.Button active block style={{ height: 18 }} />
      <Skeleton.Button active block style={{ height: 18 }} />
      <Skeleton.Button active style={{ height: 18, width: '78%' }} />
    </Flexbox>
    <Skeleton.Button active block style={{ borderRadius: 8, height: 320 }} />
  </Flexbox>
));

export default Loading;
