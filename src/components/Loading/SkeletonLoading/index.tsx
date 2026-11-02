'use client';

import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { ArticleSkeleton } from '@/components/Skeleton';
import { sx } from '@/styles/sx';

const styles = stylex.create({
  root: { padding: { default: null, [media.sm]: '16px' } },
});

const SkeletonLoading = memo<{ className?: string }>(({ className }) => (
  <ArticleSkeleton className={sx([styles.root], className).className} rows={8} />
));

export default SkeletonLoading;
