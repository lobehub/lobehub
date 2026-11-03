'use client';

import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { MoreHorizontalIcon, PencilIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoriteMenuItem } from '@/features/Favorites';
import NavItem from '@/features/NavPanel/components/NavItem';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { openRenameProjectModal } from '@/features/Projects/RenameProjectModal';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { ProjectListItem } from '@/store/project';

// `avatar` is an emoji or image URL, not a component: `Icon` would pass it to
// createElement as a tag name and crash the whole page.
export const projectIcon = (project: Pick<ProjectListItem, 'avatar' | 'name'>) => (
  <ProjectAvatar avatar={project.avatar} name={project.name} size={18} />
);

interface ProjectItemProps {
  project: ProjectListItem;
}

const ProjectItem = memo<ProjectItemProps>(({ project }) => {
  const { t } = useTranslation('project');
  const canManage = useCanManageProject();
  const projectPath = `/project/${project.slug ?? project.id}`;
  const favoriteMenuItem = useFavoriteMenuItem(
    {
      icon: project.avatar ?? null,
      // The slug can be renamed from Project Settings, where this row is not
      // mounted to refresh the snapshot; the id link always resolves.
      path: `/project/${project.id}`,
      targetId: project.id,
      title: project.name,
      type: 'project',
    },
    { showHotkey: false },
  );

  const menuItems: DropdownItem[] = [
    ...(favoriteMenuItem ? [favoriteMenuItem] : []),
    ...(canManage
      ? ([
          { type: 'divider' },
          {
            icon: <Icon icon={PencilIcon} />,
            key: 'rename',
            label: t('rename.action'),
            onClick: () => openRenameProjectModal(project),
          },
        ] satisfies DropdownItem[])
      : []),
  ];

  return (
    <WorkspaceLink to={projectPath}>
      <NavItem
        contextMenuItems={menuItems}
        icon={projectIcon(project)}
        title={project.name}
        actions={
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontalIcon} size={'small'} />
          </DropdownMenu>
        }
      />
    </WorkspaceLink>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default ProjectItem;
