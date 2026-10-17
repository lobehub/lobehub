'use client';

import { Block, createStaticStyles, cssVar, Flexbox, responsive } from '@lobehub/ui';

import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import AgentProfileNavSkeleton from './AgentProfileNav';
import SkeletonBar from './Bar';

/** Platform cards drawn by the list skeleton — the built-in catalog fills three rows. */
const PLATFORM_CARD_COUNT = 9;

const styles = createStaticStyles(({ css }) => ({
  // `content-box` so the 1px divider sits outside the measured row height,
  // matching `Form.Field divider` / `Form.Group` (64px rows, 45px group header).
  advanced: css`
    box-sizing: content-box;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  card: css`
    min-height: 104px;
  `,
  field: css`
    box-sizing: content-box;
    min-height: 64px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    width: 100%;

    ${responsive.md} {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    ${responsive.sm} {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;

    width: 100%;
    min-height: 0;
  `,
  title: css`
    height: 34px;
    margin-block-end: 20px;
  `,
}));

/**
 * Body of the agent channel list (`features/AgentChannel/PlatformGrid.tsx`):
 * 24px section padding around a 1024px column, the 24px/600 h1 with its inline
 * 28px agent avatar, then the 3/2/1-column grid of outlined platform cards
 * (24px icon + bold name, two 12px description lines). Also the page's own
 * data-loading state, so route load and platform fetch share one shape.
 */
export const AgentChannelListBodySkeleton = () => (
  <div aria-busy className={styles.root}>
    <Flexbox padding={24} width={'100%'}>
      <Flexbox style={{ alignSelf: 'center', maxWidth: 1024, width: '100%' }}>
        <Flexbox horizontal align={'center'} className={styles.title} gap={8}>
          <SkeletonBar height={24} width={220} />
          <SkeletonBar height={28} width={28} />
          <SkeletonBar height={24} width={96} />
        </Flexbox>
        <div className={styles.grid}>
          {Array.from({ length: PLATFORM_CARD_COUNT }).map((_, index) => (
            <Block className={styles.card} gap={8} key={index} padding={12} variant={'outlined'}>
              <Flexbox horizontal align={'center'} gap={8} height={24}>
                <SkeletonBar height={24} width={24} />
                <SkeletonBar height={14} width={56 + (index % 3) * 12} />
              </Flexbox>
              <Flexbox gap={6} paddingBlock={3}>
                <SkeletonBar height={12} width={'92%'} />
                <SkeletonBar height={12} width={`${48 + (index % 3) * 10}%`} />
              </Flexbox>
            </Block>
          ))}
        </div>
      </Flexbox>
    </Flexbox>
  </div>
);

/**
 * Body of a platform detail (`features/AgentChannel/PlatformDetail`): the 1024px
 * outlined credential block — field rows with a 20px icon + label on the left
 * and a half-width input on the right, then the collapsed advanced-settings
 * group — followed by the right-aligned save button of the footer.
 */
export const AgentChannelDetailBodySkeleton = () => (
  <div aria-busy className={styles.root}>
    <Flexbox
      align={'center'}
      paddingInline={24}
      style={{ paddingBlock: '16px 24px' }}
      width={'100%'}
    >
      <Flexbox paddingBlock={16} style={{ maxWidth: 1024 }} width={'100%'}>
        <Block paddingInline={16} variant={'outlined'}>
          {[112, 40, 128].map((labelWidth, index) => (
            <Flexbox
              horizontal
              align={'center'}
              className={styles.field}
              gap={16}
              justify={'space-between'}
              key={index}
            >
              <Flexbox horizontal align={'center'} gap={8}>
                <SkeletonBar height={20} width={20} />
                <SkeletonBar height={14} width={labelWidth} />
              </Flexbox>
              <SkeletonBar height={32} width={'50%'} />
            </Flexbox>
          ))}
          {/* Collapsed `Form.Group` header: a 28px title button at the top of a 45px row. */}
          <Flexbox className={styles.advanced} height={45}>
            <Flexbox justify={'center'} style={{ height: 28 }}>
              <SkeletonBar height={13} width={52} />
            </Flexbox>
          </Flexbox>
        </Block>
      </Flexbox>
      <Flexbox
        horizontal
        justify={'flex-end'}
        style={{ maxWidth: 1024, paddingBlockStart: 16 }}
        width={'100%'}
      >
        <SkeletonBar height={32} width={82} />
      </Flexbox>
    </Flexbox>
  </div>
);

/**
 * Route-level skeleton for `/agent/:aid/channel` (see `agentChannelRouteMeta`):
 * the profile header (breadcrumb, centred tabs, "…" menu) over the list body.
 */
export const AgentChannelSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <AgentProfileNavSkeleton actions={1} />}
    <AgentChannelListBodySkeleton />
  </Flexbox>
);

/**
 * Route-level skeleton for `/agent/:aid/channel/:platform` (see
 * `agentChannelDetailRouteMeta`): breadcrumb `Agent › Channels › Platform`
 * without the tab switcher, docs + "…" actions, over the credential form.
 */
export const AgentChannelDetailSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <AgentProfileNavSkeleton actions={2} breadcrumbItems={2} tabs={false} />}
    <AgentChannelDetailBodySkeleton />
  </Flexbox>
);
