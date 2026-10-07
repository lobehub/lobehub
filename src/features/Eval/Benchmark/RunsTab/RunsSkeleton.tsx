import { Flexbox } from '@lobehub/ui';
import { Skeleton, SkeletonText } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';

import { runRowStyles } from './RunRow';

const styles = createStaticStyles(({ css }) => ({
  block: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  header: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

/** Shaped like run groups: agent header, then model rows. */
const RunsSkeleton = () => (
  <Flexbox gap={16}>
    {[3, 1].map((rows, i) => (
      <div className={styles.block} key={i}>
        <Flexbox horizontal align="center" className={styles.header} gap={10}>
          <Skeleton height={24} style={{ borderRadius: '50%' }} width={24} />
          <Flexbox gap={6}>
            <SkeletonText width={140} />
            <SkeletonText width={200} />
          </Flexbox>
        </Flexbox>
        {Array.from({ length: rows }).map((_, r) => (
          <div className={`${runRowStyles.grid} ${runRowStyles.row}`} key={r}>
            <SkeletonText width={160} />
            <SkeletonText width={72} />
            <Skeleton height={6} width={'100%'} />
            <SkeletonText data-optional width={40} />
            <SkeletonText data-optional width={40} />
            <SkeletonText data-optional width={64} />
            <span />
          </div>
        ))}
      </div>
    ))}
  </Flexbox>
);

export default RunsSkeleton;
