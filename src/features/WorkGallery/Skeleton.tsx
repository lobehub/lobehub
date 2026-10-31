import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import ArticleSkeleton from '@/components/Skeleton/Article';

const styles = stylex.create({
  card: {
    aspectRatio: 0.9,
    padding: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: {
      'default': 'repeat(3, minmax(280px, 1fr))',
      '@media (width >= 1600px)': 'repeat(4, minmax(280px, 1fr))',
      '@media (width <= 920px)': 'repeat(2, minmax(280px, 1fr))',
      '@media (width <= 620px)': 'minmax(0, 1fr)',
    },
    gap: '16px',
    width: '100%',
  },
  scroll: {
    overflowX: 'hidden',
    overflowY: 'auto',
    flex: '1',
    minHeight: '0',
    paddingBlockStart: '8px',
    paddingBlockEnd: '24px',
    paddingInline: '24px',
  },
});

export const WorkGalleryCardsSkeleton = memo<{ count?: number }>(({ count = 8 }) => (
  <div {...stylex.props(styles.grid)}>
    {Array.from({ length: count }).map((_, index) => (
      <div {...stylex.props(styles.card)} key={index}>
        <ArticleSkeleton rows={6} />
      </div>
    ))}
  </div>
));

WorkGalleryCardsSkeleton.displayName = 'WorkGalleryCardsSkeleton';

const WorkGallerySkeleton = () => (
  <Flexbox aria-busy height={'100%'}>
    <Flexbox className={stylex.props(styles.scroll).className}>
      <WorkGalleryCardsSkeleton />
    </Flexbox>
  </Flexbox>
);

export default WorkGallerySkeleton;
