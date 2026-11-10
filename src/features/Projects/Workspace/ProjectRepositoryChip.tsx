'use client';

import { Github } from '@lobehub/icons';
import { type DropdownItem, DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronDownIcon, PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { repositorySlug } from '@/features/ChatInput/ControlBar/sandboxEnvironmentOptions';
import { workingDirectoryChipStyles } from '@/features/ChatInput/ControlBar/workingDirectoryChipStyles';

import { openAddRepositoryModal } from './AddRepositoryModal';
import type { useProjectRepository } from './useProjectRepository';

interface ProjectRepositoryChipProps {
  /** Whether this member may link a repository to the project. */
  canManage: boolean;
  disabled?: boolean;
  projectId: string;
  state: ReturnType<typeof useProjectRepository>;
}

/**
 * Which of the project's repositories a new conversation works in. A project
 * without one offers to add it here, linked to the project in the same step —
 * the conversation needs nothing else to start on the code.
 */
const ProjectRepositoryChip = ({
  canManage,
  disabled,
  projectId,
  state,
}: ProjectRepositoryChipProps) => {
  const { t } = useTranslation('project');
  const { loaded, repositories, repository, setPickedId } = state;

  const addRepository = () => openAddRepositoryModal({ onAdded: setPickedId, projectId });

  if (!loaded) return null;

  if (!repository) {
    if (!canManage) return null;
    return (
      <button
        disabled={disabled}
        type={'button'}
        {...stylex.props(workingDirectoryChipStyles.chip, styles.button)}
        onClick={addRepository}
      >
        <Icon icon={PlusIcon} size={14} />
        <span>{t('overview.context.repository.add')}</span>
      </button>
    );
  }

  const label = (
    <>
      <Github size={14} />
      <span {...stylex.props(workingDirectoryChipStyles.label)}>
        {(repositorySlug(repository) ?? repository.name).split('/').pop() || repository.name}
      </span>
    </>
  );

  const items: DropdownItem[] = [
    ...repositories.map((environment) => ({
      extra: environment.id === repository.id ? <Icon icon={CheckIcon} size={14} /> : undefined,
      icon: <Github size={14} />,
      key: environment.id,
      label: repositorySlug(environment) ?? environment.name,
      onClick: () => setPickedId(environment.id),
    })),
    ...(canManage
      ? [
          { type: 'divider' as const },
          {
            icon: <Icon icon={PlusIcon} />,
            key: 'add',
            label: t('overview.context.repository.add'),
            onClick: addRepository,
          },
        ]
      : []),
  ];

  const chip = (
    <button
      data-testid={'project-repository-chip'}
      disabled={disabled}
      type={'button'}
      {...stylex.props(workingDirectoryChipStyles.chip, styles.button)}
    >
      {label}
      <Icon icon={ChevronDownIcon} size={12} />
    </button>
  );

  return (
    <Tooltip title={t('overview.context.repository.tooltip')}>
      <div>
        {disabled ? (
          chip
        ) : (
          <DropdownMenu items={items} placement={'bottomRight'}>
            {chip}
          </DropdownMenu>
        )}
      </div>
    </Tooltip>
  );
};

const styles = stylex.create({
  button: {
    borderWidth: 0,
    fontFamily: 'inherit',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
  },
});

export default ProjectRepositoryChip;
