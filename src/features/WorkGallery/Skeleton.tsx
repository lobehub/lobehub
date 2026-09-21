import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

import ArticleSkeleton from '@/components/Skeleton/Article';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    aspect-ratio: 0.9;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;

    background: ${cssVar.colorBgContainer};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(280px, 1fr));
    gap: 16px;
    width: 100%;

    @media (width >= 1600px) {
      grid-template-columns: repeat(4, minmax(280px, 1fr));
    }

    @media (width <= 920px) {
      grid-template-columns: repeat(2, minmax(280px, 1fr));
    }

    @media (width <= 620px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  scroll: css`
    overflow: hidden auto;
    flex: 1;

    min-height: 0;
    padding-block: 8px 24px;
    padding-inline: 24px;
  `,
}));

export const WorkGalleryCardsSkeleton = memo<{ count?: number }>(({ count = 8 }) => (
  <div className={styles.grid}>
    {Array.from({ length: count }).map((_, index) => (
      <div className={styles.card} key={index}>
        <ArticleSkeleton rows={6} />
      </div>
    ))}
  </div>
));

WorkGalleryCardsSkeleton.displayName = 'WorkGalleryCardsSkeleton';

const WorkGallerySkeleton = () => (
  <Flexbox aria-busy height={'100%'}>
    <Flexbox className={styles.scroll}>
      <WorkGalleryCardsSkeleton />
    </Flexbox>
  </Flexbox>
);

export default WorkGallerySkeleton;
