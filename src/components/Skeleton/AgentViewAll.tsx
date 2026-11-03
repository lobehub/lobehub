'use client';

import { Block, Center, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import SkeletonBar from './Bar';

/** Match `ACTION_COL_WIDTH` / `NAME_COL_WIDTH` / `ROLE_COL_WIDTH` in `features/AgentViewAll/AgentRow.tsx`. */
const ACTION_COL_WIDTH = 64;
const NAME_COL_WIDTH = 240;
const ROLE_COL_WIDTH = 200;

const styles = stylex.create({
  sidebarCard: { minHeight: '72px', paddingBlock: '10px', paddingInline: '12px' },
  sidebarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))',
    gap: '12px',
  },
  sidebarSection: {
    padding: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

/**
 * The "In sidebar" block (`features/AgentViewAll/SidebarAgentsSection.tsx`)
 * that sits above the toolbar once the list loads whenever any agent shows in
 * the sidebar — i.e. for almost every account. Without it the toolbar and rows
 * dropped by the block's height on load. Honors the persisted collapsed state;
 * an expanded block reserves one row of mini cards (the item count is unknown
 * until the list arrives).
 */
export const AgentViewAllSidebarSectionSkeleton = () => {
  const collapsed = useGlobalStore(systemStatusSelectors.agentListSidebarSectionCollapsed);

  return (
    <Flexbox
      className={stylex.props(styles.sidebarSection).className}
      data-testid={'agent-view-all-sidebar-skeleton'}
      gap={12}
    >
      <Flexbox horizontal align={'center'} height={20} justify={'space-between'}>
        <SkeletonBar height={13} width={72} />
        <SkeletonBar height={12} width={40} />
      </Flexbox>
      {!collapsed && (
        <div {...stylex.props(styles.sidebarGrid)}>
          {[0, 1, 2].map((key) => (
            <Block
              className={stylex.props(styles.sidebarCard).className}
              data-testid={'agent-view-all-sidebar-card-skeleton'}
              key={key}
              variant={'outlined'}
            >
              <Flexbox horizontal align={'center'} flex={1} gap={8}>
                <SkeletonBar height={24} width={24} />
                <SkeletonBar height={14} width={`${36 + key * 12}%`} />
              </Flexbox>
            </Block>
          ))}
        </div>
      )}
    </Flexbox>
  );
};

/**
 * Dense `AgentRow`s of the list view (`agentListViewMode: 'list'`,
 * `groupBy: 'none'`): padding 8/12, 28px square avatar, then the name / role /
 * description columns, then the
 * right-aligned 88px update-time column and the 64px eye / "…" action column.
 * Also the page's own loading state while the agent list initialises.
 */
export const AgentViewAllRowsSkeleton = ({ rows = 8 }: { rows?: number }) => (
  <Flexbox aria-busy gap={2}>
    {Array.from({ length: rows }).map((_, index) => (
      <Flexbox horizontal align={'center'} gap={12} key={index} paddingBlock={8} paddingInline={12}>
        <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
          <SkeletonBar height={28} width={28} />
          <Flexbox flex={'0 1 auto'} style={{ minWidth: 0, width: NAME_COL_WIDTH }}>
            <SkeletonBar height={14} width={`${50 + (index % 4) * 10}%`} />
          </Flexbox>
          <Flexbox flex={'0 1 auto'} style={{ minWidth: 0, width: ROLE_COL_WIDTH }}>
            <SkeletonBar height={12} width={`${40 + (index % 3) * 15}%`} />
          </Flexbox>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <SkeletonBar height={12} width={`${30 + (index % 5) * 8}%`} />
          </Flexbox>
        </Flexbox>
        <Flexbox align={'flex-end'} flex={'none'} style={{ minWidth: 88 }}>
          <SkeletonBar height={12} width={56} />
        </Flexbox>
        <Flexbox horizontal align={'center'} flex={'none'} gap={4} width={ACTION_COL_WIDTH}>
          {[0, 1].map((key) => (
            <Center height={24} key={key} width={24}>
              <SkeletonBar height={14} width={14} />
            </Center>
          ))}
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

/**
 * Route-level skeleton for `/agents` (`features/AgentViewAll/AgentViewAllPage.tsx`):
 * the 44px header (title left, list-config icon right), then the full-width column
 * with the "In sidebar" block and the toolbar (240px-max search left, split
 * create button right) over list-view rows (also the loading state of the card view).
 */
const AgentViewAllSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && (
      <Flexbox
        horizontal
        align={'center'}
        flex={'none'}
        height={44}
        justify={'space-between'}
        padding={8}
      >
        <Flexbox style={{ paddingInlineStart: 4 }}>
          <SkeletonBar height={14} width={48} />
        </Flexbox>
        <SkeletonBar height={28} width={28} />
      </Flexbox>
    )}
    <WideScreenContainer fullWidth gap={16} paddingBlock={16} paddingInline={16}>
      <AgentViewAllSidebarSectionSkeleton />
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
        <SkeletonBar height={32} width={206} />
        <SkeletonBar height={32} width={64} />
      </Flexbox>
      <AgentViewAllRowsSkeleton />
    </WideScreenContainer>
  </Flexbox>
);

export default AgentViewAllSkeleton;
