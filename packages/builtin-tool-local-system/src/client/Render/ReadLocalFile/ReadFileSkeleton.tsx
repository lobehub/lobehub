import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import React, { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,

  meta: css`
    font-size: 12px;
  `,
}));

const ReadFileSkeleton = memo(() => {
  return (
    <Flexbox className={styles.container} gap={2}>
      <Flexbox horizontal align={'center'} gap={24} justify={'space-between'}>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ overflow: 'hidden' }}>
          <Skeleton.Block active style={{ flex: 1, height: 16, width: 20 }} />

          <Skeleton.Block active style={{ flex: 1, height: 16, minWidth: 100 }} />
        </Flexbox>
        <Flexbox align={'center'} className={styles.meta} gap={16}>
          <Skeleton.Block active style={{ height: 16, maxWidth: 40 }} />
        </Flexbox>
      </Flexbox>

      {/* Path */}
      <Skeleton.Block active style={{ height: 16, width: '100%' }} />
    </Flexbox>
  );
});

export default ReadFileSkeleton;
