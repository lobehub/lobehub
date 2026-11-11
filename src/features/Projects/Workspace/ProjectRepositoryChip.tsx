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
  /** Icon only, the repository in the tooltip — for a narrow composer. */
  compact?: boolean;
  disabled?: boolean;
  projectId: string;
  /** Repositories added here are published: the agent is workspace-public and applies nothing else. */
  publish?: boolean;
  state: ReturnType<typeof useProjectRepository>;
}

/**
 * Which of the project's repositories a new conversation works in. A project
 * without one offers to add it here, linked to the project in the same step —
 * the conversation needs nothing else to start on the code.
 */
const ProjectRepositoryChip = ({
  canManage,
  compact,
  disabled,
  projectId,
  publish,
  state,
}: ProjectRepositoryChipProps) => {
  const { t } = useTranslation('project');
  const { loaded, repositories, repository, setPickedId } = state;

  const addRepository = () => openAddRepositoryModal({ onAdded: setPickedId, projectId, publish });

  if (!loaded) return null;

  if (!repository) {
    if (!canManage) return null;
    return (
      <button
        aria-label={t('overview.context.repository.add')}
        disabled={disabled}
        title={compact ? t('overview.context.repository.add') : undefined}
        type={'button'}
        {...stylex.props(workingDirectoryChipStyles.chip, styles.button)}
        onClick={addRepository}
      >
        <Icon icon={PlusIcon} size={14} />
        {!compact && <span>{t('overview.context.repository.add')}</span>}
      </button>
    );
  }

  const slug = repositorySlug(repository) ?? repository.name;
  const label = (
    <>
      <Github size={14} />
      {!compact && (
        <span {...stylex.props(workingDirectoryChipStyles.label)}>
          {slug.split('/').pop() || repository.name}
        </span>
      )}
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
      aria-label={slug}
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
    <Tooltip
      title={
        compact
          ? `${slug} · ${t('overview.context.repository.tooltip')}`
          : t('overview.context.repository.tooltip')
      }
    >
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
  // Body size and color: the tray says where the work happens, not a footnote.
  button: {
    borderWidth: 0,
    fontFamily: 'inherit',
    fontSize: '13px',
    color: cssVar.colorText,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillSecondary },
  },
});

export default ProjectRepositoryChip;
