'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import {
  OVERVIEW_PANEL_WIDTH,
  resolveWorkingPanelPlaceholder,
} from '@/features/Conversation/WorkingSidebar/layout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import SkeletonBar from '../Bar';
import ConversationLayoutSkeleton from './Layout';

const styles = createStaticStyles(({ css }) => ({
  overviewCard: css`
    margin: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 16px;
    background: ${cssVar.colorBgContainer};
  `,
  rightPanel: css`
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const PanelRows = ({ rows }: { rows: number }) => (
  <Flexbox gap={12} padding={16}>
    <SkeletonBar height={16} width={120} />
    {Array.from({ length: rows }).map((_, index) => (
      <SkeletonBar height={12} key={index} width={`${60 + ((index * 17) % 35)}%`} />
    ))}
  </Flexbox>
);

const AgentConversationLayoutSkeleton = () => {
  const [showRightPanel, showWorkingOverview, workingSidebarWidth] = useGlobalStore((s) => [
    systemStatusSelectors.showRightPanel(s),
    systemStatusSelectors.showWorkingOverview(s),
    systemStatusSelectors.workingSidebarWidth(s),
  ]);
  const { overview, rightPanelWidth } = resolveWorkingPanelPlaceholder({
    showRightPanel,
    showWorkingOverview,
    workingSidebarWidth,
  });

  return (
    <Flexbox horizontal flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
      <ConversationLayoutSkeleton
        aside={
          overview && (
            <Flexbox flex={'none'} width={OVERVIEW_PANEL_WIDTH + 32}>
              <Flexbox className={styles.overviewCard}>
                <PanelRows rows={5} />
              </Flexbox>
            </Flexbox>
          )
        }
      />
      {rightPanelWidth && (
        <Flexbox className={styles.rightPanel} flex={'none'} width={rightPanelWidth}>
          <PanelRows rows={8} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default AgentConversationLayoutSkeleton;
