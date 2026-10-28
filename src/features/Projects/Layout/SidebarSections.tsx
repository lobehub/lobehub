import { AccordionRoot } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { type TopicListScopeAgent } from '@/features/AgentSidebar/Topic/TopicListScope';
import { ChannelSection } from '@/features/Channels/ChannelList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { ProjectDirectoryTopics } from '../WorkingDirectories/SidebarTopics';

export enum ProjectSidebarKey {
  Channels = 'channels',
  Topics = 'topics',
}

const DEFAULT_EXPANDED: Record<string, boolean> = {
  [ProjectSidebarKey.Channels]: true,
  [ProjectSidebarKey.Topics]: true,
};

interface SidebarSectionsProps {
  coordinatorAgent?: TopicListScopeAgent;
  coordinatorAgentId: string;
  projectId: string;
}

/** The project's Channels above its topics, each collapsible and remembered per project. */
const SidebarSections = memo<SidebarSectionsProps>(
  ({ coordinatorAgent, coordinatorAgentId, projectId }) => {
    const sections = useGlobalStore(systemStatusSelectors.projectSidebarSections(projectId));
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

    const expandedKeys = useMemo(() => {
      const resolved = { ...DEFAULT_EXPANDED, ...sections };
      return Object.keys(resolved).filter((key) => resolved[key]);
    }, [sections]);

    return (
      <AccordionRoot
        indicatorPlacement="inline"
        style={{ gap: 8, paddingBlock: 12 }}
        value={expandedKeys}
        onValueChange={(next) => {
          const keys = next as string[];
          updateSystemStatus({
            expandProjectSidebarSectionsByProject: {
              [projectId]: Object.fromEntries(
                Object.values(ProjectSidebarKey).map((key) => [key, keys.includes(key)]),
              ),
            },
          });
        }}
      >
        <ChannelSection itemKey={ProjectSidebarKey.Channels} projectId={projectId} />
        <ProjectDirectoryTopics
          coordinatorAgent={coordinatorAgent}
          coordinatorAgentId={coordinatorAgentId}
          itemKey={ProjectSidebarKey.Topics}
          projectId={projectId}
        />
      </AccordionRoot>
    );
  },
);

SidebarSections.displayName = 'ProjectSidebarSections';

export default SidebarSections;
