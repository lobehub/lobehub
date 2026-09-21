import { memo } from 'react';

import { useTopicDrawerArtifactPortal } from '@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal';
import { PortalContent } from '@/features/Portal/router';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';
import { TaskAgentProvider } from './TaskAgentProvider';

interface AgentTaskManagerProps {
  preferredAgentId?: string;
  viewedTaskId?: string;
}

const AgentTaskManager = memo<AgentTaskManagerProps>(({ preferredAgentId, viewedTaskId }) => {
  const [expand, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
  const [portalView, showPortal] = useChatStore((s) => [
    chatPortalSelectors.currentViewType(s),
    chatPortalSelectors.showStandalonePortal(s),
  ]);
  const showArtifactInTopicDrawer = useTopicDrawerArtifactPortal();
  const showPortalInTaskPanel = showPortal && !showArtifactInTopicDrawer;

  return (
    <RightPanel
      defaultWidth={420}
      expand={expand || showPortalInTaskPanel}
      maxWidth={720}
      minWidth={320}
      width={portalView === PortalViewType.AcceptanceCheck ? 640 : undefined}
      onExpandChange={(next) => toggleTaskAgentPanel(next)}
    >
      {/* Artifact cards in the run drawer keep that reading context. Other task
          portals render here because Tasks routes have no desktop Portal host. */}
      {showPortalInTaskPanel ? (
        <PortalContent />
      ) : (
        <TaskAgentProvider preferredAgentId={preferredAgentId} viewedTaskId={viewedTaskId}>
          <Conversation />
        </TaskAgentProvider>
      )}
    </RightPanel>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
