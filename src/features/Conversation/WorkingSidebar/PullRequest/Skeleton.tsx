import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { sectionProps, sectionStyles } from '../Overview/sectionStyles';
import PrHead, { PrStatePill, PrTitle } from './Head';

const styles = stylex.create({
  dock: {
    flexShrink: 0,
    paddingBlockStart: '8px',
    paddingBlockEnd: '10px',
    paddingInline: '8px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  root: { flex: '1', minHeight: '0' },
  row: { minHeight: '32px', paddingBlock: '5px', paddingInline: '8px' },
  sectionBody: { paddingBlockStart: '2px', paddingBlockEnd: '6px', paddingInline: '8px' },
});

const Row = ({ trailing = 48 }: { trailing?: number }) => (
  <Flexbox horizontal align={'center'} className={stylex.props(styles.row).className} gap={8}>
    <Skeleton height={14} radius={4} width={14} />
    <Skeleton.Text width={'55%'} />
    <Skeleton height={12} radius={4} style={{ marginInlineStart: 'auto' }} width={trailing} />
  </Flexbox>
);

const SectionTitle = ({ width = 64 }: { width?: number }) => (
  <div {...stylex.props(sectionStyles.sectionHeader)}>
    <Skeleton height={10} radius={4} width={width} />
  </div>
);

const PullRequestSkeleton = memo(({ summary }: { summary?: DeviceGitLinkedPullRequest }) => {
  return (
    <Flexbox className={stylex.props(styles.root).className}>
      <Flexbox className={stylex.props(styles.root).className}>
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
        <Flexbox {...sectionProps()}>
          <SectionTitle width={72} />
          <div {...stylex.props(styles.sectionBody)}>
            <Skeleton.Text fontSize={13} rows={3} width={['100%', '88%', '46%']} />
          </div>
        </Flexbox>
        <Flexbox {...sectionProps()}>
          <SectionTitle width={40} />
          <Row trailing={72} />
        </Flexbox>
        <Flexbox {...sectionProps()}>
          <SectionTitle width={56} />
        </Flexbox>
        <Flexbox {...sectionProps()}>
          <SectionTitle width={52} />
          <Row />
          <Row />
        </Flexbox>
      </Flexbox>
      <div {...stylex.props(styles.dock)}>
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
