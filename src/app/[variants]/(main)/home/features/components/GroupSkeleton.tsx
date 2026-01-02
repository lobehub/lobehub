'use client';

import { Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

export const GroupSkeleton = memo<{
  height?: number | string;
  rows?: number;
  width?: number | string;
}>(({ rows = 12, width, height }) => {
  return Array.from({ length: rows }).map((_, i) => (
    <Skeleton.Button
      active
      key={i}
      size={'large'}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        height: height,
        maxHeight: height,
        maxWidth: width,
        minWidth: width,
        opacity: 0.5,
      }}
    />
  ));
});

export default GroupSkeleton;
