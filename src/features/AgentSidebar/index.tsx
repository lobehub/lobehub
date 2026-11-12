import { RenderProfiler } from '@/components/RenderProfiler';
import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';

import AgentSidebarContent from './Content';

const Sidebar = () => {
  return (
    <NavPanelPortal navKey="agent">
      {/* The portal only registers its children; NavPanelHost renders them, so
          the profiler must travel with the content to see its renders. */}
      <RenderProfiler region={'sidebar'}>
        <AgentSidebarContent />
      </RenderProfiler>
    </NavPanelPortal>
  );
};

export default Sidebar;
