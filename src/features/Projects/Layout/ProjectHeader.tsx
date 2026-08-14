'use client';

import { Flexbox } from '@lobehub/ui';
import { SquareKanbanIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import {
  SidebarHeaderSelectPopover,
  SidebarHeaderSelectTrigger,
} from '@/features/NavPanel/SidebarHeaderSelect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { ProjectDetail } from '@/store/project';
import { useCurrentProjectList, useProjectStore } from '@/store/project';

interface ProjectHeaderProps {
  project?: ProjectDetail['project'];
}

const ProjectHeader = memo<ProjectHeaderProps>(({ project }) => {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const projects = useCurrentProjectList();
  useProjectStore((s) => s.useFetchProjectList)(true);

  const handleSelect = (projectId: string) => navigate(`/project/${projectId}`);

  const content = (
    <Flexbox gap={4} padding={8} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
      {projects.map((item) => (
        <NavItem
          active={item.id === project?.id}
          icon={item.avatar || SquareKanbanIcon}
          key={item.id}
          title={item.name}
          onClick={() => handleSelect(item.id)}
        />
      ))}
    </Flexbox>
  );

  return (
    <SideBarHeaderLayout
      backTo="/"
      left={
        <SidebarHeaderSelectPopover content={content}>
          <SidebarHeaderSelectTrigger
            avatar={project?.avatar || project?.name || t('sidebar.title')}
            title={project?.name || t('sidebar.title')}
          />
        </SidebarHeaderSelectPopover>
      }
    />
  );
});

ProjectHeader.displayName = 'ProjectHeader';

export default ProjectHeader;
