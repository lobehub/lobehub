import { Skeleton, SkeletonText } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  wall: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '24px',
    marginInline: 'auto',
    maxWidth: '1120px',
    paddingBlock: '32px',
    paddingInline: '32px',
    width: '100%',
  },
  head: { display: 'flex', justifyContent: 'space-between' },
  grid: {
    display: 'grid',
    gap: '12px',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
  },
  page: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '36px',
    marginInline: 'auto',
    maxWidth: '760px',
    paddingBlock: '32px',
    paddingInline: '32px',
    width: '100%',
  },
});

/** Same frame as the loaded wall, so nothing jumps when data arrives. */
export const WallSkeleton = memo(() => (
  <div aria-busy {...stylex.props(styles.wall)}>
    <div {...stylex.props(styles.head)}>
      <Skeleton height={28} width={96} />
      <Skeleton height={32} radius={8} width={280} />
    </div>
    <Skeleton height={20} width={120} />
    <div {...stylex.props(styles.grid)}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton height={176} key={i} radius={12} width={'100%'} />
      ))}
    </div>
  </div>
));

WallSkeleton.displayName = 'StoryWallSkeleton';

export const PageSkeleton = memo(() => (
  <div aria-busy {...stylex.props(styles.page)}>
    <SkeletonText fontSize={24} rows={3} width={['12%', '30%', '60%']} />
    <SkeletonText fontSize={17} rows={3} width={['10%', '100%', '75%']} />
    <Skeleton height={160} radius={12} width={'100%'} />
    <Skeleton height={160} radius={12} width={'100%'} />
  </div>
));

PageSkeleton.displayName = 'StoryPageSkeleton';
