import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  card: {
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  grid: { display: 'grid', gap: '16px', paddingBlock: '12px' },
});

interface MasonrySkeletonProps {
  columnCount: number;
}

const MasonrySkeleton = memo<MasonrySkeletonProps>(({ columnCount }) => {
  // Generate varying heights for more natural masonry look
  const heights = [160, 180, 170, 160, 190, 170, 160, 180];

  // Calculate number of items based on column count (max 2 columns for modal)
  const itemCount = Math.min(columnCount * 3, 8);

  return (
    <div
      className={stylex.props(styles.grid).className}
      style={{
        gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
      }}
    >
      {Array.from({ length: itemCount }).map((_, index) => (
        <div {...stylex.props(styles.card)} key={index}>
          <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
            <Skeleton.Avatar size={48} />
            <Flexbox gap={16} style={{ height: heights[index % heights.length] }} width={'100%'}>
              <Skeleton.Text width={'80%'} />
              <Skeleton.Text rows={3} width={['100%', '90%', '70%']} />
            </Flexbox>
          </Flexbox>
        </div>
      ))}
    </div>
  );
});

MasonrySkeleton.displayName = 'MasonrySkeleton';

export default MasonrySkeleton;
