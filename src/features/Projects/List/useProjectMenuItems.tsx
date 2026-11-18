import { type DropdownItem, Icon, toast } from '@lobehub/ui';
import { PencilIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFavoriteMenuItem } from '@/features/Favorites';
import { createDeleteProjectModal } from '@/features/Projects/DeleteProjectModal';
import { openRenameProjectModal } from '@/features/Projects/RenameProjectModal';
import { useCanManageProject } from '@/features/Projects/useCanManageProject';
import { useProjectStore } from '@/store/project';
import type { ProjectListItem } from '@/store/project/store';

import { projectFavoriteTarget } from '../projectFavorite';

/** Favorite, rename and delete for one project, shared by its row and its folder card. */
export const useProjectMenuItems = (project: ProjectListItem) => {
  const { t } = useTranslation(['project', 'common']);
  const [deleting, setDeleting] = useState(false);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const canManage = useCanManageProject();
  const favoriteMenuItem = useFavoriteMenuItem(projectFavoriteTarget(project), {
    showHotkey: false,
  });

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProject(project.id);
    } catch (error) {
      // On success the row unmounts, so only a failure re-enables it.
      setDeleting(false);
      throw error;
    }
    toast.success(t('list.deleteSuccess', { name: project.name }));
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
          {
            danger: true,
            icon: <Icon icon={TrashIcon} />,
            key: 'delete',
            label: t('list.deleteAction'),
            onClick: () => {
              createDeleteProjectModal({
                onConfirm: handleDelete,
                project: { id: project.id, name: project.name },
              });
            },
          },
        ] satisfies DropdownItem[])
      : []),
  ];

  return { deleting, menuItems };
};
