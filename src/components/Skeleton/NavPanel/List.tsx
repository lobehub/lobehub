'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';

import SkeletonBar from '../Bar';

export const SkeletonItem = ({
  padding = 6,
  height = 36,
  style,
  avatarSize = 28,
  ...rest
}: { avatarSize?: number } & Omit<FlexboxProps, 'children'>) => (
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
);

export const SkeletonList = ({
  rows = 3,
  ...rest
}: { rows?: number } & Omit<FlexboxProps, 'children'>) => (
  <Flexbox gap={2} {...rest}>
    {Array.from({ length: rows }).map((_, index) => (
      <SkeletonItem key={index} />
    ))}
  </Flexbox>
);

export default SkeletonList;
