import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sx } from '@/styles/sx';

const pulse = stylex.keyframes({
  '0%, 100%': { opacity: 1 },
  '50%': { opacity: 0.6 },
});

const styles = stylex.create({
  card: {
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
    animationName: pulse,
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  grid: {
    display: 'grid',
    gap: '16px',
    paddingBlock: '12px',
    paddingInline: '24px',
  },
});

interface MasonrySkeletonProps {
  columnCount: number;
}

const MasonryViewSkeleton = memo<MasonrySkeletonProps>(({ columnCount }) => {
  // Generate varying heights for more natural masonry look
  const heights = [180, 220, 200, 190, 240, 210, 200, 230, 180, 220, 210, 190];

  // Calculate number of items based on viewport and column count, minimum 6 items
  const itemCount = Math.max(Math.min(columnCount * 3, 12), 6);

  // Calculate opacity gradient from 100% to 20%
  const getOpacity = (index: number) => 1 - (index / (itemCount - 1)) * 0.8;

  return (
    <div
      {...sx([styles.grid], undefined, {
        gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
      })}
    >
      {Array.from({ length: itemCount }).map((_, index) => (
        <div
          key={index}
          {...sx([styles.card], undefined, {
            height: heights[index % heights.length],
            opacity: getOpacity(index),
          })}
        />
      ))}
    </div>
  );
});

MasonryViewSkeleton.displayName = 'MasonryViewSkeleton';

export default MasonryViewSkeleton;
