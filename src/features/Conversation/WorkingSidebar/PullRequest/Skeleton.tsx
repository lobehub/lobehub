import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { sectionStyles } from '../Overview/sectionStyles';
import PrHead, { PrStatePill, PrTitle } from './Head';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dock: css`
    flex-shrink: 0;
    padding-block: 8px 10px;
    padding-inline: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    flex: 1;
    min-height: 0;
  `,
  row: css`
    min-height: 32px;
    padding-block: 5px;
    padding-inline: 8px;
  `,
  sectionBody: css`
    padding-block: 2px 6px;
    padding-inline: 8px;
  `,
}));

const Row = ({ trailing = 48 }: { trailing?: number }) => (
  <Flexbox horizontal align={'center'} className={styles.row} gap={8}>
    <Skeleton height={14} radius={4} width={14} />
    <Skeleton.Text width={'55%'} />
    <Skeleton height={12} radius={4} style={{ marginInlineStart: 'auto' }} width={trailing} />
  </Flexbox>
);

const SectionTitle = ({ width = 64 }: { width?: number }) => (
  <div className={sectionStyles.sectionHeader}>
    <Skeleton height={10} radius={4} width={width} />
  </div>
);

const PullRequestSkeleton = memo(({ summary }: { summary?: DeviceGitLinkedPullRequest }) => {
  return (
    <Flexbox className={styles.root}>
      <Flexbox className={styles.root}>
        <PrHead
          meta={
            <>
              {summary ? (
                <PrStatePill pr={summary} />
              ) : (
                <Skeleton height={20} radius={6} width={56} />
              )}
              <Skeleton height={18} radius={4} width={96} />
              <Skeleton height={18} radius={4} width={64} />
            </>
          }
          title={
            summary ? (
              <PrTitle number={summary.number} title={summary.title} />
            ) : (
              <Skeleton.Text fontSize={15} rows={2} width={['92%', '60%']} />
            )
          }
        />
        <Flexbox className={sectionStyles.section}>
          <SectionTitle width={72} />
          <div className={styles.sectionBody}>
            <Skeleton.Text fontSize={13} rows={3} width={['100%', '88%', '46%']} />
          </div>
        </Flexbox>
        <Flexbox className={sectionStyles.section}>
          <SectionTitle width={40} />
          <Row trailing={72} />
        </Flexbox>
        <Flexbox className={sectionStyles.section}>
          <SectionTitle width={56} />
        </Flexbox>
        <Flexbox className={sectionStyles.section}>
          <SectionTitle width={52} />
          <Row />
          <Row />
        </Flexbox>
      </Flexbox>
      <div className={styles.dock}>
        <Row trailing={40} />
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ paddingBlock: '6px 0', paddingInline: 8 }}
        >
          <Skeleton height={24} radius={6} width={'100%'} />
        </Flexbox>
      </div>
    </Flexbox>
  );
});

PullRequestSkeleton.displayName = 'PullRequestSkeleton';

export default PullRequestSkeleton;
