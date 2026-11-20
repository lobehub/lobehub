'use client';

import { createStaticStyles, cssVar, Flexbox, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import { densityVars } from '@/styles/densityVars';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    display: flex;
    gap: ${densityVars.contentGap};
    align-items: center;

    padding-block: ${densityVars.contentGap};
    padding-inline: ${densityVars.cardPadding};
    border-radius: ${cssVar.borderRadius};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    .${prefixCls}-skeleton-header {
      padding: 0;
    }
  `,
  paragraph: css`
    margin-block: 8px 0 !important;

    > li {
      height: 12px !important;
    }
  `,
  title: css`
    height: 16px !important;
    margin-block-end: 0 !important;

    > li {
      height: 16px !important;
    }
  `,
}));

interface SkeletonListProps {
  count?: number;
}

const SkeletonList = memo<SkeletonListProps>(({ count = 4 }) => {
  return (
    <Flexbox gap={4}>
      {Array.from({ length: count }).map((_, index) => (
        <Flexbox horizontal align="center" className={styles.item} gap={12} key={index}>
          <Skeleton.Avatar
            shape="square"
            size={40}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <Flexbox gap={16} width={'100%'}>
              <Skeleton.Text className={styles.title} width={'60%'} />
              <Skeleton.Text className={styles.paragraph} width={'80%'} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default SkeletonList;
