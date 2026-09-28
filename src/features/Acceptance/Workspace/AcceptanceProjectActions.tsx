'use client';

import type { DropdownItem } from '@lobehub/ui/base-ui';
import Icon from '@lobehub/ui/es/Icon/index';
import { Eye, Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

export const getAcceptanceProjectActionTypes = (projectId?: string) =>
  projectId ? (['viewProject', 'divider', 'createProject'] as const) : (['createProject'] as const);

/**
 * The project entries the acceptance list offers, as MENU ITEMS rather than a
 * rendered menu.
 *
 * The list panel owns the menu chrome so the header can carry one overflow menu
 * for everything it offers — the multi-select toggle lives there too, and two
 * adjacent "…" buttons would be nonsense. What stays injected is the ITEMS:
 * they open the create-project modal and navigate to `/project/:id`, neither of
 * which exists in the standalone workbench app, and importing them directly
 * would drag the project store into its bundle.
 */
export const useAcceptanceProjectActionItems = () => {
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(
    (projectId?: string): DropdownItem[] =>
      getAcceptanceProjectActionTypes(projectId).map((action) => {
        if (action === 'divider') return { type: 'divider' };

        return action === 'viewProject'
          ? {
              icon: <Icon icon={Eye} />,
              key: action,
              label: t('acceptance.workspace.groups.viewProject'),
              onClick: () => navigate(`/project/${projectId}`),
            }
          : {
              icon: <Icon icon={Plus} />,
              key: action,
              label: t('acceptance.workspace.groups.createProject'),
              onClick: () => openCreateProjectModal(),
            };
      }),
    [navigate, t],
  );
};
