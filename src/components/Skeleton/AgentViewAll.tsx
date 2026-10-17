'use client';

import { Block, Center, createStaticStyles, cssVar, Flexbox, responsive } from '@lobehub/ui';

import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import SkeletonBar from './Bar';

/** Matches `ACTION_COL_WIDTH` in `features/AgentViewAll/AgentRow.tsx`. */
const ACTION_COL_WIDTH = 64;

const styles = createStaticStyles(({ css }) => ({
  sidebarCard: css`
    min-height: 72px;
    padding-block: 10px;
    padding-inline: 12px;
  `,
  sidebarGrid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;

    ${responsive.md} {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    ${responsive.sm} {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  sidebarSection: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));

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
      className={styles.sidebarSection}
      data-testid={'agent-view-all-sidebar-skeleton'}
      gap={12}
    >
      <Flexbox horizontal align={'center'} height={20} justify={'space-between'}>
        <SkeletonBar height={13} width={72} />
        <SkeletonBar height={12} width={40} />
      </Flexbox>
      {!collapsed && (
        <div className={styles.sidebarGrid}>
          {[0, 1, 2].map((key) => (
            <Block
              className={styles.sidebarCard}
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
 * Dense `AgentRow`s of the default list view (`agentListViewMode: 'list'`,
 * `groupBy: 'none'`): padding 8/12, 28px square avatar + 14px name, then the
 * right-aligned 88px update-time column and the 64px eye / "…" action column.
 * Also the page's own loading state while the agent list initialises.
 */
export const AgentViewAllRowsSkeleton = ({ rows = 8 }: { rows?: number }) => (
  <Flexbox aria-busy gap={2}>
    {Array.from({ length: rows }).map((_, index) => (
      <Flexbox horizontal align={'center'} gap={12} key={index} paddingBlock={8} paddingInline={12}>
        <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ minWidth: 0 }}>
          <SkeletonBar height={28} width={28} />
          <SkeletonBar height={14} width={`${18 + (index % 4) * 6}%`} />
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
 * the 44px header (title left, list-config icon right), then the 960px column
 * with the "In sidebar" block and the toolbar (240px-max search left, split
 * create button right) over the default list view's rows.
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
    <WideScreenContainer gap={16} paddingBlock={16}>
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
