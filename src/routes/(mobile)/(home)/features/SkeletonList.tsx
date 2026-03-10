'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
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
        <Flexbox className={styles.item} key={index}>
          <Skeleton.Avatar
            active
            shape="square"
            size={40}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <Skeleton
              active
              paragraph={{ className: styles.paragraph, rows: 1, width: '80%' }}
              title={{ className: styles.title, width: '60%' }}
            />
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default SkeletonList;
