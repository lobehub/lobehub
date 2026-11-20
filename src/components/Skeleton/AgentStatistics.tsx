'use client';

import { Block, Flexbox, Grid, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import AgentProfileNavSkeleton from './AgentProfileNav';
import SkeletonBar from './Bar';

const styles = stylex.create({
  tableHead: {
    borderTopLeftRadius: cssVar.borderRadius,
    borderTopRightRadius: cssVar.borderRadius,
    borderBottomRightRadius: '0',
    borderBottomLeftRadius: '0',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  tableRow: {
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
});

/** Label + small Segmented pair of the controls row (`维度 [按天|按周]`). */
const LabelledSegmentedSkeleton = ({
  labelWidth,
  segmentedWidth,
}: {
  labelWidth: number;
  segmentedWidth: number;
}) => (
  <Flexbox horizontal align={'center'} gap={8}>
    <SkeletonBar height={13} width={labelWidth} />
    <SkeletonBar height={34} radius={cssVar.borderRadiusLG} width={segmentedWidth} />
  </Flexbox>
);

/**
 * The three `StatisticCard`s of `AgentUsage/StatCards.tsx`: a 32px title line,
 * a 24px value line, and (cost-saving / token cards only) a 12px description
 * 16px below. Same `Grid` props as the real cards so the columns line up.
 */
export const AgentStatCardsSkeleton = () => (
  <Grid gap={8} maxItemWidth={240} rows={3}>
    {[96, 128, 112].map((titleWidth, index) => (
      <Flexbox flex={1} key={index}>
        <Flexbox justify={'center'} style={{ height: 32 }}>
          <SkeletonBar height={16} width={titleWidth} />
        </Flexbox>
        <Flexbox gap={16}>
          <Flexbox justify={'center'} style={{ height: 29 }}>
            <SkeletonBar height={24} width={index === 2 ? 40 : 72} />
          </Flexbox>
          {index > 0 && (
            <Flexbox justify={'center'} style={{ height: 19 }}>
              <SkeletonBar height={12} width={index === 1 ? 112 : 96} />
            </Flexbox>
          )}
        </Flexbox>
      </Flexbox>
    ))}
  </Grid>
);

/**
 * Body rows of the `ModelBreakdown` table (antd `size="middle"`, 12/16px cell
 * padding): model icon + name/provider on the left, then right-aligned
 * requests / tokens / cost columns.
 */
const ModelBreakdownRowsSkeleton = () => (
  <Flexbox>
    {Array.from({ length: 3 }).map((_, index) => (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.tableRow).className}
        gap={16}
        key={index}
        paddingBlock={12}
        paddingInline={16}
      >
        <Flexbox horizontal align={'center'} flex={1} gap={8}>
          <SkeletonBar height={20} radius={'50%'} width={20} />
          <Flexbox gap={6}>
            <SkeletonBar height={14} width={120 + (index % 3) * 24} />
            <SkeletonBar height={12} width={56 + (index % 2) * 16} />
          </Flexbox>
        </Flexbox>
        <Flexbox align={'flex-end'} flex={1}>
          <SkeletonBar height={14} width={32} />
        </Flexbox>
        <Flexbox align={'flex-end'} flex={1}>
          <SkeletonBar height={14} width={48} />
        </Flexbox>
        <Flexbox align={'flex-end'} flex={1}>
          <SkeletonBar height={14} width={48} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

/** Header row + body rows of the `ModelBreakdown` table; also its own loading state. */
export const AgentModelBreakdownTableSkeleton = () => (
  <Flexbox>
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.tableHead).className}
      gap={16}
      height={44}
      paddingInline={16}
    >
      <Flexbox flex={1}>
        <SkeletonBar height={13} width={28} />
      </Flexbox>
      {[40, 44, 28].map((width, index) => (
        <Flexbox align={'flex-end'} flex={1} key={index}>
          <SkeletonBar height={13} width={width} />
        </Flexbox>
      ))}
    </Flexbox>
    <ModelBreakdownRowsSkeleton />
  </Flexbox>
);

/** Section title row: 16px title (25px line) with an optional Segmented on the right. */
const SectionTitleSkeleton = ({ segmented, width }: { segmented?: boolean; width: number }) => (
  <Flexbox
    horizontal
    align={'center'}
    justify={'space-between'}
    style={{ minHeight: segmented ? 40 : 25 }}
  >
    <SkeletonBar height={16} width={width} />
    {segmented && <SkeletonBar height={40} radius={cssVar.borderRadiusLG} width={124} />}
  </Flexbox>
);

/**
 * Body of `/agent/:aid/statistics` (`features/AgentUsage`): three outlined
 * blocks in the 960px column — controls + stat cards, the usage-trend chart
 * (title + Spend/Token Segmented over a 320px chart), and the per-model
 * breakdown table.
 */
export const AgentStatisticsBodySkeleton = () => (
  <Flexbox aria-busy gap={16} paddingBlock={16}>
    <Block gap={16} padding={20} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <LabelledSegmentedSkeleton labelWidth={26} segmentedWidth={100} />
        <LabelledSegmentedSkeleton labelWidth={52} segmentedWidth={136} />
      </Flexbox>
      <AgentStatCardsSkeleton />
    </Block>
    <Block gap={16} padding={20} variant={'outlined'}>
      <SectionTitleSkeleton segmented width={112} />
      <Skeleton height={320} />
    </Block>
    <Block gap={16} padding={20} variant={'outlined'}>
      <SectionTitleSkeleton width={80} />
      <AgentModelBreakdownTableSkeleton />
    </Block>
  </Flexbox>
);

/** Route-level skeleton for `/agent/:aid/statistics` (see `agentStatisticsRouteMeta`). */
const AgentStatisticsSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <AgentProfileNavSkeleton />}
    <Flexbox flex={1} style={{ minHeight: 0, overflow: 'hidden' }}>
      <WideScreenContainer>
        <AgentStatisticsBodySkeleton />
      </WideScreenContainer>
    </Flexbox>
  </Flexbox>
);

export default AgentStatisticsSkeleton;
