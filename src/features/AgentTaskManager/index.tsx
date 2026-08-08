import { memo } from 'react';

import { PortalContent } from '@/features/Portal/router';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';
import { TaskAgentProvider } from './TaskAgentProvider';

const AgentTaskManager = memo(() => {
  const [expand, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
  const portalView = useChatStore(chatPortalSelectors.currentViewType);
  const showAcceptance =
    portalView === PortalViewType.Acceptance || portalView === PortalViewType.AcceptanceCheck;

  return (
    <RightPanel
      defaultWidth={420}
      expand={expand}
      maxWidth={720}
      minWidth={320}
      width={portalView === PortalViewType.AcceptanceCheck ? 640 : undefined}
      onExpandChange={(next) => toggleTaskAgentPanel(next)}
    >
      {showAcceptance ? (
        <PortalContent />
      ) : (
        <TaskAgentProvider>
          <Conversation />
        </TaskAgentProvider>
      )}
    </RightPanel>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
