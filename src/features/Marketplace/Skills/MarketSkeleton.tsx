import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { SkeletonBar } from '@/components/Skeleton';

import MarketCard from './MarketCard';

const styles = stylex.create({
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
  },
  divider: {
    height: 1,
    backgroundColor: cssVar.colorBorderSecondary,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 16,
    rowGap: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
    paddingBlock: 8,
    paddingInline: 8,
  },
  text: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
  },
});

/** Text widths vary per row so a column of skeletons does not read as one block. */
const NAME_WIDTHS = ['46%', '58%', '38%', '52%'];
const BLURB_WIDTHS = ['82%', '70%', '90%', '64%'];

/** One list row: icon tile, name and blurb lines, and the "+" at the end. */
export const RowSkeleton = memo<{ index?: number }>(({ index = 0 }) => (
  <div {...stylex.props(styles.row)}>
    <SkeletonBar height={40} radius={10} width={40} />
    <span {...stylex.props(styles.text)}>
      <SkeletonBar height={14} width={NAME_WIDTHS[index % NAME_WIDTHS.length]} />
      <SkeletonBar height={12} width={BLURB_WIDTHS[index % BLURB_WIDTHS.length]} />
    </span>
    <SkeletonBar height={24} radius={6} width={24} />
  </div>
));

RowSkeleton.displayName = 'MarketRowSkeleton';

/** Rows in the two-column grid every Market list uses. */
export const RowGridSkeleton = memo<{ count?: number }>(({ count = 4 }) => (
  <div {...stylex.props(styles.grid)}>
    {Array.from({ length: count }, (_, index) => (
      <RowSkeleton index={index} key={index} />
    ))}
  </div>
));

RowGridSkeleton.displayName = 'MarketRowGridSkeleton';

/** A category block: its rule, a title, and its rows. */
export const SectionSkeleton = memo<{ count?: number }>(({ count = 4 }) => (
  <Flexbox gap={8}>
    <div {...stylex.props(styles.divider)} />
    <Flexbox horizontal align={'center'} justify={'space-between'} paddingBlock={8}>
      <SkeletonBar height={16} width={96} />
      <SkeletonBar height={14} width={56} />
    </Flexbox>
    <RowGridSkeleton count={count} />
  </Flexbox>
));

SectionSkeleton.displayName = 'MarketSectionSkeleton';

/** The featured cards: picture, name, author and a two-line blurb. */
export const FeaturedSkeleton = memo(() => (
  <Flexbox gap={8}>
    <div {...stylex.props(styles.divider)} />
    <Flexbox paddingBlock={8}>
      <SkeletonBar height={16} width={64} />
    </Flexbox>
    <div {...stylex.props(styles.cards)}>
      {Array.from({ length: 3 }, (_, index) => (
        <MarketCard gap={8} key={index}>
          <Flexbox horizontal justify={'space-between'} style={{ marginBlockEnd: 4 }}>
            <SkeletonBar height={48} radius={12} width={48} />
            <SkeletonBar height={24} radius={6} width={24} />
          </Flexbox>
          <SkeletonBar height={14} width={NAME_WIDTHS[index]} />
          <SkeletonBar height={12} width={'32%'} />
          <SkeletonBar height={12} width={'92%'} />
          <SkeletonBar height={12} width={BLURB_WIDTHS[index]} />
        </MarketCard>
      ))}
    </div>
  </Flexbox>
));

FeaturedSkeleton.displayName = 'MarketFeaturedSkeleton';

/** A detail page below its header: the figures strip and the information card. */
export const DetailBodySkeleton = memo(() => (
  <Flexbox gap={24}>
    <MarketCard>
      <Flexbox horizontal gap={16} justify={'space-around'}>
        {Array.from({ length: 4 }, (_, index) => (
          <Flexbox align={'center'} gap={8} key={index}>
            <SkeletonBar height={12} width={48} />
            <SkeletonBar height={22} width={56} />
            <SkeletonBar height={12} width={40} />
          </Flexbox>
        ))}
      </Flexbox>
    </MarketCard>
    <Flexbox gap={8}>
      <SkeletonBar height={16} width={64} />
      <MarketCard>
        {[0, 1, 2].map((index) => (
          <Flexbox horizontal gap={24} key={index}>
            <SkeletonBar height={14} width={72} />
            <SkeletonBar height={14} width={BLURB_WIDTHS[index]} />
          </Flexbox>
        ))}
      </MarketCard>
    </Flexbox>
  </Flexbox>
));

DetailBodySkeleton.displayName = 'MarketDetailBodySkeleton';
