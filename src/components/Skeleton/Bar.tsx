'use client';

import { Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

export interface SkeletonBarProps {
  height: number;
  radius?: number | string;
  width?: number | string;
}

const SkeletonBar = memo<SkeletonBarProps>(({ height, width = '100%', radius }) => (
  <Skeleton.Button
    active
    block
    size={'small'}
    style={{
      borderRadius: radius ?? cssVar.borderRadius,
      height,
      margin: 0,
      maxHeight: height,
      maxWidth: width,
      minHeight: height,
      minWidth: width,
      padding: 0,
      width,
    }}
  />
));

SkeletonBar.displayName = 'SkeletonBar';

export default SkeletonBar;
