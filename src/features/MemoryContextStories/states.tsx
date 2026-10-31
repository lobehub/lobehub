import { Skeleton, SkeletonText } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  page: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '36px',
    marginInline: 'auto',
    maxWidth: '760px',
    paddingBlock: '40px',
    paddingInline: '48px',
    width: '100%',
  },
});

export const PageSkeleton = memo(() => (
  <div aria-busy {...stylex.props(styles.page)}>
    <SkeletonText fontSize={24} rows={3} width={['12%', '30%', '60%']} />
    <SkeletonText fontSize={17} rows={3} width={['10%', '100%', '75%']} />
    <Skeleton height={160} radius={12} width={'100%'} />
    <Skeleton height={160} radius={12} width={'100%'} />
  </div>
));

PageSkeleton.displayName = 'StoryPageSkeleton';
