'use client';

import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import Icon from '@lobehub/ui/es/Icon/index';
import { Eye, MoreHorizontal, Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

interface AcceptanceProjectActionsProps {
  projectId?: string;
}

export const getAcceptanceProjectActionTypes = (projectId?: string) =>
  projectId ? (['viewProject', 'divider', 'createProject'] as const) : (['createProject'] as const);

const AcceptanceProjectActions = memo<AcceptanceProjectActionsProps>(({ projectId }) => {
  const { t } = useTranslation('verify');
  const navigate = useWorkspaceAwareNavigate();
  const items: DropdownItem[] = getAcceptanceProjectActionTypes(projectId).map((action) => {
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
  });

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon
        icon={MoreHorizontal}
        size={'small'}
        title={t('acceptance.workspace.groups.actions')}
      />
    </DropdownMenu>
  );
});

AcceptanceProjectActions.displayName = 'AcceptanceProjectActions';

export default AcceptanceProjectActions;
