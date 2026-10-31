'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import {
  OVERVIEW_PANEL_WIDTH,
  resolveWorkingPanelPlaceholder,
} from '@/features/Conversation/WorkingSidebar/layout';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import SkeletonBar from '../Bar';
import ConversationLayoutSkeleton from './Layout';

const styles = stylex.create({
  overviewCard: {
    margin: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  rightPanel: {
    borderInlineStartWidth: '1px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
});

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
              <Flexbox className={stylex.props(styles.overviewCard).className}>
                <PanelRows rows={5} />
              </Flexbox>
            </Flexbox>
          )
        }
      />
      {rightPanelWidth && (
        <Flexbox
          className={stylex.props(styles.rightPanel).className}
          flex={'none'}
          width={rightPanelWidth}
        >
          <PanelRows rows={8} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default AgentConversationLayoutSkeleton;
