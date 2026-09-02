'use client';

import { cssVar } from 'antd-style';

export interface SkeletonBarProps {
  height: number;
  radius?: number | string;
  width?: number | string;
}

const SkeletonBar = ({ height, width = '100%', radius }: SkeletonBarProps) => (
  <div
    aria-hidden
    style={{
      background: cssVar.colorFillTertiary,
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
