'use client';

import { memo } from 'react';

import { PortalContent } from '@/features/Portal/router';
import { usePortalPanelWidth } from '@/features/Portal/usePortalPanelWidth';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import AssigneeProfileAvatar from '../AssigneeProfileAvatar';
import { AssigneeAvatarContext, type RenderAssigneeAvatar } from './assigneeSlot';
import ExplorationGraph from './ExplorationGraph';
import type { GraphProps } from './graphTypes';

/**
 * The exploration map as the app mounts it: the store-free `ExplorationGraph`
 * plus the chat portal, so a node drills down and the fullscreen overlay
 * carries its own right-hand panel. A host with no portal (the share page)
 * imports `ExplorationGraph` directly.
 */
const renderAssigneeAvatar: RenderAssigneeAvatar = ({ agentId, size }) => (
  <AssigneeProfileAvatar agentId={agentId} size={size} />
);

const Graph = memo<GraphProps>((props) => {
  const openNode = useChatStore((s) => s.openGoalNode);
  const showPortal = useChatStore(chatPortalSelectors.showPortal);
  const currentViewType = useChatStore(chatPortalSelectors.currentViewType);
  const clearPortalStack = useChatStore((s) => s.clearPortalStack);
  // Same 'goal' width scope as the page's panel, so the drill-down keeps its
  // size when it moves between the page and the fullscreen overlay.
  const { maxWidth, minWidth, updateWidth, width } = usePortalPanelWidth(currentViewType, 'goal');

  return (
    <AssigneeAvatarContext value={renderAssigneeAvatar}>
      <ExplorationGraph
        {...props}
        refitKey={showPortal}
        fullscreenAside={
          // The overlay covers the page's portal panel, so it carries its own:
          // clicking a node keeps the same drill-down chain without leaving the
          // map. The page unmounts its copy while we are fullscreen.
          <RightPanel
            expand={showPortal}
            maxWidth={maxWidth}
            minWidth={minWidth}
            width={width}
            onSizeChange={(size) => updateWidth(size?.width)}
            onExpandChange={(next) => {
              if (!next) clearPortalStack();
            }}
          >
            <PortalContent />
          </RightPanel>
        }
        onInspect={(id) => openNode(props.graph.goal.id, id)}
      />
    </AssigneeAvatarContext>
  );
});

Graph.displayName = 'GoalExplorationGraph';

export default Graph;
