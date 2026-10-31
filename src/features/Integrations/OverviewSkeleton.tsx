'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { SkeletonBar } from '@/components/Skeleton';

import { INTEGRATIONS, UPCOMING_INTEGRATIONS } from './registry';

const styles = stylex.create({
  card: {
    paddingBlock: '14px',
    paddingInline: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  list: { display: 'grid', gridTemplateColumns: '1fr', gap: '10px' },
  upcoming: {
    display: 'grid',
    gridTemplateColumns: { 'default': 'repeat(2, 1fr)', '@media (width <= 720px)': '1fr' },
    gap: '8px',
  },
  upcomingCard: { paddingBlock: '10px', paddingInline: '14px' },
});

/** Section label line (12px text, ~20px line box). */
const Label = ({ width }: { width: number }) => (
  <Flexbox height={20} justify={'center'}>
    <SkeletonBar height={12} width={width} />
  </Flexbox>
);

const CardSkeleton = ({ upcoming }: { upcoming?: boolean }) => (
  <Block
    className={stylex.props(styles.card, upcoming && styles.upcomingCard).className}
    variant={'filled'}
  >
    <Flexbox horizontal align={'center'} gap={14}>
      <SkeletonBar
        height={upcoming ? 32 : 40}
        radius={cssVar.borderRadius}
        width={upcoming ? 32 : 40}
      />
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Flexbox height={24} justify={'center'}>
          <SkeletonBar height={15} width={upcoming ? 72 : 88} />
        </Flexbox>
        {!upcoming && (
          <Flexbox height={22} justify={'center'}>
            <SkeletonBar height={13} width={'60%'} />
          </Flexbox>
        )}
      </Flexbox>
      <SkeletonBar height={13} width={upcoming ? 64 : 80} />
    </Flexbox>
  </Block>
);

/**
 * Integrations directory placeholder: the "All" list and the "Coming soon" grid
 * with the registry's real card counts. The connected strip is data-driven, so
 * it is not predicted here.
 */
const OverviewSkeleton = () => (
  <Flexbox aria-busy gap={24}>
    <Flexbox gap={10}>
      <Label width={40} />
      <div {...stylex.props(styles.list)}>
        {Array.from({ length: Math.max(INTEGRATIONS.length, 1) }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </Flexbox>
    <Flexbox gap={10}>
      <Label width={72} />
      <div {...stylex.props(styles.upcoming)}>
        {UPCOMING_INTEGRATIONS.map((item) => (
          <CardSkeleton upcoming key={item.id} />
        ))}
      </div>
    </Flexbox>
  </Flexbox>
);

export default OverviewSkeleton;
