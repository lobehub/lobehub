'use client';

import type { MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { FolderClosedIcon, MoreHorizontalIcon, PencilIcon, TrashIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { openRenameProjectModal } from '@/features/Projects/RenameProjectModal';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import type { ProjectListItem } from '@/store/project';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface ProjectItemProps {
  project: ProjectListItem;
}

const ProjectItem = memo<ProjectItemProps>(({ project }) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const canManage = currentUserId === project.userId;

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

  const menuItems: MenuProps['items'] = canManage
    ? [
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
      ]
    : [];

  return (
    <WorkspaceLink to={`/project/${project.slug ?? project.id}`}>
      <NavItem
        contextMenuItems={canManage ? menuItems : undefined}
        disabled={deleting}
        icon={project.avatar || FolderClosedIcon}
        title={project.name}
        actions={
          canManage ? (
            <DropdownMenu items={menuItems}>
              <ActionIcon icon={MoreHorizontalIcon} loading={deleting} size={'small'} />
            </DropdownMenu>
          ) : undefined
        }
      />
    </WorkspaceLink>
  );
});

ProjectItem.displayName = 'ProjectItem';

export default ProjectItem;
