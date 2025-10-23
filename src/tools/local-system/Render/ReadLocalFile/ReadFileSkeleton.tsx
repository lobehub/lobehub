import { Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import React, { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
  `,

  meta: css`
    font-size: 12px;
  `,
}));

const ReadFileSkeleton = memo(() => {
  const { styles } = useStyles();

  return (
    <Flexbox className={styles.container} gap={2}>
      <Flexbox align={'center'} gap={24} horizontal justify={'space-between'}>
        <Flexbox align={'center'} flex={1} gap={8} horizontal style={{ overflow: 'hidden' }}>
          <Skeleton.Node active style={{ flex: 1, height: 16, width: 20 }} />

          <Skeleton.Node active style={{ flex: 1, height: 16, minWidth: 100 }} />
        </Flexbox>
        <Flexbox align={'center'} className={styles.meta} gap={16}>
          <Skeleton.Node active style={{ height: 16, maxWidth: 40 }} />
        </Flexbox>
      </Flexbox>

      {/* Path */}
      <Skeleton.Node active style={{ height: 16, width: '100%' }} />
    </Flexbox>
  );
});

export default ReadFileSkeleton;
