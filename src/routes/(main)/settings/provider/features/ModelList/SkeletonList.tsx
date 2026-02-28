'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    gap: 24px;
    align-items: center;
    justify-content: space-between;

    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  leftContent: css`
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;

    min-width: 0;
  `,
  rightContent: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
  textContent: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;

    min-width: 0;
  `,
}));

export const Placeholder = memo(() => {
  return (
    <Flexbox horizontal className={styles.container}>
      <Flexbox horizontal className={styles.leftContent}>
        <Skeleton.Avatar active shape="square" size={32} style={{ flex: 'none' }} />
        <Flexbox className={styles.textContent}>
          <Skeleton.Button
            active
            size={'small'}
            style={{
              height: 18,
              width: 160,
            }}
          />
          <Flexbox horizontal gap={4}>
            <Skeleton.Button
              active
              size={'small'}
              style={{
                height: 16,
                width: 60,
              }}
            />
            <Skeleton.Button
              active
              size={'small'}
              style={{
                height: 16,
                width: 40,
              }}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal className={styles.rightContent}>
        <Skeleton.Button
          active
          size={'small'}
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

export const SkeletonList = memo(() => (
  <Flexbox gap={4} paddingBlock={12}>
    {Array.from({ length: 6 }).map((_, i) => (
      <Placeholder key={i} />
    ))}
  </Flexbox>
));

export default SkeletonList;
