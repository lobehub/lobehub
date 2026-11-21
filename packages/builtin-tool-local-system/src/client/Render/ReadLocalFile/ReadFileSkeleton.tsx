import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import React, { memo } from 'react';

const styles = stylex.create({
  container: {
    padding: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  meta: { fontSize: '12px' },
});

const ReadFileSkeleton = memo(() => {
  return (
    <Flexbox className={stylex.props(styles.container).className} gap={2}>
      <Flexbox horizontal align={'center'} gap={24} justify={'space-between'}>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ overflow: 'hidden' }}>
          <Skeleton height={16} style={{ flex: 1 }} width={20} />

          <Skeleton height={16} style={{ flex: 1, minWidth: 100 }} />
        </Flexbox>
        <Flexbox align={'center'} className={stylex.props(styles.meta).className} gap={16}>
          <Skeleton height={16} style={{ maxWidth: 40 }} />
        </Flexbox>
      </Flexbox>

      <Skeleton height={16} />
    </Flexbox>
  );
});

export default ReadFileSkeleton;
