'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  container: {
    display: 'flex',
    gap: '24px',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px',
    borderRadius: cssVar.borderRadiusLG,
  },
  leftContent: { display: 'flex', flex: '1', gap: '8px', alignItems: 'center', minWidth: '0' },
  rightContent: { display: 'flex', gap: '4px', alignItems: 'center' },
  textContent: { display: 'flex', flex: '1', flexDirection: 'column', gap: '4px', minWidth: '0' },
});

export const Placeholder = memo(() => {
  return (
    <Flexbox horizontal className={stylex.props(styles.container).className}>
      <Flexbox horizontal className={stylex.props(styles.leftContent).className}>
        <Skeleton.Avatar shape="square" size={32} style={{ flex: 'none' }} />
        <Flexbox className={stylex.props(styles.textContent).className}>
          <Skeleton height={18} width={160} />
          <Flexbox horizontal gap={4}>
            <Skeleton height={16} width={60} />
            <Skeleton height={16} width={40} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal className={stylex.props(styles.rightContent).className}>
        <Skeleton
          style={{
            borderRadius: 12,
            height: 22,
            width: 44,
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

export const SkeletonList = () => (
  <Flexbox gap={4} paddingBlock={12}>
    {Array.from({ length: 6 }).map((_, i) => (
      <Placeholder key={i} />
    ))}
  </Flexbox>
);

export default SkeletonList;
