'use client';

import { Block, createStaticStyles, cssVar, cx, Flexbox } from '@lobehub/ui';

import { SkeletonBar } from '@/components/Skeleton';

import { INTEGRATIONS, UPCOMING_INTEGRATIONS } from './registry';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Card chrome mirrors `IntegrationCard` (filled block, LG radius, 14/16 padding).
  card: css`
    padding-block: 14px;
    padding-inline: 16px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  list: css`
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  `,
  upcoming: css`
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  upcomingCard: css`
    padding-block: 10px;
    padding-inline: 14px;
  `,
}));

/** Section label line (12px text, ~20px line box). */
const Label = ({ width }: { width: number }) => (
  <Flexbox height={20} justify={'center'}>
    <SkeletonBar height={12} width={width} />
  </Flexbox>
);

const CardSkeleton = ({ upcoming }: { upcoming?: boolean }) => (
  <Block className={cx(styles.card, upcoming && styles.upcomingCard)} variant={'filled'}>
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
      <div className={styles.list}>
        {Array.from({ length: Math.max(INTEGRATIONS.length, 1) }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    </Flexbox>
    <Flexbox gap={10}>
      <Label width={72} />
      <div className={styles.upcoming}>
        {UPCOMING_INTEGRATIONS.map((item) => (
          <CardSkeleton upcoming key={item.id} />
        ))}
      </div>
    </Flexbox>
  </Flexbox>
);

export default OverviewSkeleton;
