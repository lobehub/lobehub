'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

// The former `.ant-skeleton-header` and `> li` rules matched antd's skeleton DOM,
// which lobe-ui's Skeleton no longer renders, so they are not carried over.
const styles = stylex.create({
  item: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  paragraph: {
    marginBlockStart: '8px',
    marginBlockEnd: 0,
  },
  title: {
    height: '16px',
    marginBlockEnd: 0,
  },
});

interface SkeletonListProps {
  count?: number;
}

const SkeletonList = memo<SkeletonListProps>(({ count = 4 }) => {
  return (
    <Flexbox gap={4}>
      {Array.from({ length: count }).map((_, index) => (
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.item).className}
          gap={12}
          key={index}
        >
          <Skeleton.Avatar
            shape="square"
            size={40}
            style={{ borderRadius: cssVar.borderRadius, flex: 'none' }}
          />
          <Flexbox flex={1} style={{ overflow: 'hidden' }}>
            <Flexbox gap={16} width={'100%'}>
              <Skeleton.Text className={stylex.props(styles.title).className} width={'60%'} />
              <Skeleton.Text className={stylex.props(styles.paragraph).className} width={'80%'} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

export default SkeletonList;
