'use client';

import { Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';

export interface SkeletonBarProps {
  height: number;
  radius?: number | string;
  width?: number | string;
}

const SkeletonBar = ({ height, width = '100%', radius }: SkeletonBarProps) => (
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
);

export default SkeletonBar;
