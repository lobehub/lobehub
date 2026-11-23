import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { SkeletonBar } from '@/components/Skeleton';

import { agentGridStyles } from './AgentSection';
import MarketCard from './MarketCard';

const styles = stylex.create({
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

/** One list row: picture tile, name and blurb lines, and the "+" at the end. */
export const AgentRowSkeleton = memo<{ index?: number }>(({ index = 0 }) => (
  <div {...stylex.props(styles.row)}>
    <SkeletonBar height={40} radius={10} width={40} />
    <span {...stylex.props(styles.text)}>
      <SkeletonBar height={14} width={NAME_WIDTHS[index % NAME_WIDTHS.length]} />
      <SkeletonBar height={12} width={BLURB_WIDTHS[index % BLURB_WIDTHS.length]} />
    </span>
    <SkeletonBar height={24} radius={6} width={24} />
  </div>
));

AgentRowSkeleton.displayName = 'MarketplaceAgentRowSkeleton';

/** Rows in the two-column grid. */
export const AgentGridSkeleton = memo<{ count?: number }>(({ count = 4 }) => (
  <div {...stylex.props(agentGridStyles.grid)}>
    {Array.from({ length: count }, (_, index) => (
      <AgentRowSkeleton index={index} key={index} />
    ))}
  </div>
));

AgentGridSkeleton.displayName = 'MarketplaceAgentGridSkeleton';

/** A category block: its rule, a title, and its rows. */
export const AgentSectionSkeleton = memo<{ count?: number }>(({ count = 4 }) => (
  <Flexbox gap={8}>
    <div {...stylex.props(agentGridStyles.divider)} />
    <Flexbox horizontal align={'center'} justify={'space-between'} paddingBlock={8}>
      <SkeletonBar height={16} width={96} />
      <SkeletonBar height={14} width={56} />
    </Flexbox>
    <AgentGridSkeleton count={count} />
  </Flexbox>
));

AgentSectionSkeleton.displayName = 'MarketplaceAgentSectionSkeleton';

/** The featured cards: picture, name, author and a two-line blurb. */
export const FeaturedSkeleton = memo(() => (
  <Flexbox gap={8}>
    <div {...stylex.props(agentGridStyles.divider)} />
    <Flexbox paddingBlock={8}>
      <SkeletonBar height={16} width={64} />
    </Flexbox>
    <div {...stylex.props(agentGridStyles.cards)}>
      {Array.from({ length: 3 }, (_, index) => (
        <MarketCard gap={8} key={index}>
          <Flexbox horizontal justify={'space-between'}>
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

FeaturedSkeleton.displayName = 'MarketplaceFeaturedSkeleton';
