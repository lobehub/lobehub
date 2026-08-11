'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SkeletonBar from '../Bar';

export const SkeletonItem = memo<{ avatarSize?: number } & Omit<FlexboxProps, 'children'>>(
  ({ padding = 6, height = 36, style, avatarSize = 28, ...rest }) => (
    <Flexbox
      horizontal
      align={'center'}
      flex={1}
      gap={8}
      height={height}
      padding={padding}
      style={style}
      {...rest}
    >
      <SkeletonBar height={avatarSize} width={avatarSize} />
      <Flexbox flex={1} height={16}>
        <SkeletonBar height={16} />
      </Flexbox>
    </Flexbox>
  ),
);

SkeletonItem.displayName = 'SkeletonItem';

export const SkeletonList = memo<{ rows?: number } & Omit<FlexboxProps, 'children'>>(
  ({ rows = 3, ...rest }) => (
    <Flexbox gap={2} {...rest}>
      {Array.from({ length: rows }).map((_, index) => (
        <SkeletonItem key={index} />
      ))}
    </Flexbox>
  ),
);

SkeletonList.displayName = 'SkeletonList';

export default SkeletonList;
