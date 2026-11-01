'use client';

import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon, confirmModal, DropdownMenu, Icon, toast } from '@lobehub/ui';
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoriteMenuItem } from '@/features/Favorites';
import NavItem from '@/features/NavPanel/components/NavItem';
import ProjectAvatar from '@/features/Projects/ProjectAvatar';
import { openRenameProjectModal } from '@/features/Projects/RenameProjectModal';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { ProjectListItem } from '@/store/project';
import { useProjectStore } from '@/store/project';

// `avatar` is an emoji or image URL, not a component: `Icon` would pass it to
// createElement as a tag name and crash the whole page.
export const projectIcon = (project: Pick<ProjectListItem, 'avatar' | 'name'>) => (
  <ProjectAvatar avatar={project.avatar} name={project.name} size={18} />
);

interface ProjectItemProps {
  project: ProjectListItem;
}

const ProjectItem = memo<ProjectItemProps>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const deleteProject = useProjectStore((s) => s.deleteProject);
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

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
      toast.success(t('list.deleteSuccess', { name: project.name }));
    } catch (error) {
      console.error('Failed to delete project', error);
      toast.error(t('list.deleteError'));
      setDeleting(false);
    }
  };

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
          { type: 'divider' },
          {
            danger: true,
            icon: <Icon icon={TrashIcon} />,
            key: 'delete',
            label: t('list.deleteAction'),
            onClick: () =>
              confirmModal({
                cancelText: t('cancel', { ns: 'common' }),
                content: t('list.deleteConfirmDescription', { name: project.name }),
                okButtonProps: { danger: true },
                okText: t('delete', { ns: 'common' }),
                onOk: () => void handleDelete(),
                title: t('list.deleteConfirmTitle'),
              }),
          },
        ] satisfies DropdownItem[])
      : []),
  ];

  return (
    <WorkspaceLink to={projectPath}>
      <NavItem
        contextMenuItems={menuItems}
        disabled={deleting}
        icon={projectIcon(project)}
        title={project.name}
        actions={
          <DropdownMenu items={menuItems}>
            <ActionIcon icon={MoreHorizontalIcon} loading={deleting} size={'small'} />
          </DropdownMenu>
        }
      />
    </WorkspaceLink>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default ProjectItem;
