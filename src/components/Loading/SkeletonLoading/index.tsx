'use client';

import { createStaticStyles, cx, responsive } from 'antd-style';
import { memo } from 'react';

import { ArticleSkeleton } from '@/components/Skeleton';

const styles = createStaticStyles(
  ({ css }) => css`
    ${responsive.sm} {
      padding: 16px;
    }
  `,
);

const SkeletonLoading = memo<{ className?: string }>(({ className }) => (
  <ArticleSkeleton className={cx(styles, className)} rows={8} />
));

export default SkeletonLoading;
