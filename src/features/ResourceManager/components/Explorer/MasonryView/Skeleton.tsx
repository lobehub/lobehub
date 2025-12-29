import { createStaticStyles, keyframes } from 'antd-style';
import { memo } from 'react';

const pulse = keyframes`
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
    animation: ${pulse} 1.5s ease-in-out infinite;
  `,
  grid: css`
    display: grid;
    gap: 16px;
    padding-block: 12px;
    padding-inline: 24px;
  `,
}));

interface MasonrySkeletonProps {
  columnCount: number;
}

const MasonryViewSkeleton = memo<MasonrySkeletonProps>(({ columnCount }) => {
  // Generate varying heights for more natural masonry look
  const heights = [180, 220, 200, 190, 240, 210, 200, 230, 180, 220, 210, 190];

  // Calculate number of items based on viewport and column count
  const itemCount = Math.min(columnCount * 3, 12);

  return (
    <div
      className={styles.grid}
      style={{
        gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
      }}
    >
      {Array.from({ length: itemCount }).map((_, index) => (
        <div
          className={styles.card}
          key={index}
          style={{
            height: heights[index % heights.length],
          }}
        />
      ))}
    </div>
  );
});

MasonryViewSkeleton.displayName = 'MasonryViewSkeleton';

export default MasonryViewSkeleton;
