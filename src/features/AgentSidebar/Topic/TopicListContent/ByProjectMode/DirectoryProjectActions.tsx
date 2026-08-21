'use client';

import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import ActionIcon from '@lobehub/ui/es/ActionIcon/index';
import Icon from '@lobehub/ui/es/Icon/index';
import {
  Check,
  Eye,
  FolderInput,
  FolderMinus,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
} from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { projectService } from '@/services/project';
import { useProjectStore } from '@/store/project';

/**
 * A working directory group becomes a real project when a project owns a
 * binding for the same path. The lookup is scoped to the active workspace and
 * only fires when the menu opens — a sidebar with many directory groups must
 * not fire a project read nobody asked for.
 */
const directoryProjectKey = (workingDirectory: string) =>
  ['project/byWorkingDirectory', workingDirectory] as const;

const PROJECT_OPTIONS_KEY = ['project/directoryOptions'] as const;

interface DirectoryProjectActionsProps {
  workingDirectory?: string;
}

const getFolderName = (workingDirectory: string): string => {
  const segments = workingDirectory.split(/[/\\]+/).filter(Boolean);
  return segments.at(-1) ?? workingDirectory;
};

/**
 * The action a directory group offers, given its project lookup state. Kept as
 * data (not JSX) so the branch order — loading before bound, bound before
 * unbound — is testable without rendering a menu. A failed lookup falls back
 * to "create": the entry must never disappear because the read hiccuped.
 */
export const getDirectoryProjectActionType = ({
  isLoading,
  project,
  requested,
}: {
  isLoading?: boolean;
  project?: unknown;
  requested: boolean;
}): 'create' | 'loading' | 'view' => {
  // The lookup only starts once the menu opens; until then there is nothing
  // to show, so treat the pre-request state as loading.
  if (!requested || isLoading) return 'loading';
  // An explicit resolution (bound project, unbound, or failed lookup) ends
  // the loading state: bound → view, everything else → create.
  if (project) return 'view';
  return 'create';
};

const DirectoryProjectActions = memo<DirectoryProjectActionsProps>(({ workingDirectory }) => {
  const { t } = useTranslation('topic');
  const navigate = useWorkspaceAwareNavigate();
  const findProjectByWorkingDirectory = useProjectStore((s) => s.findProjectByWorkingDirectory);
  const refreshProjectList = useProjectStore((s) => s.refreshProjectList);
  const bindDirectory = useProjectStore((s) => s.bindDirectory);
  const listDirectories = useProjectStore((s) => s.listDirectories);
  const unbindDirectory = useProjectStore((s) => s.unbindDirectory);
  const [requested, setRequested] = useState(false);
  const [bindOptionsRequested, setBindOptionsRequested] = useState(false);

  // A group without a working directory ("no directory") has nothing to bind.
  const enabled = Boolean(workingDirectory) && requested;
  const { data, isLoading } = useClientDataSWR(
    enabled ? directoryProjectKey(workingDirectory!) : null,
    () => findProjectByWorkingDirectory(workingDirectory!),
    { revalidateOnFocus: false },
  );

  // The "bind to an existing project" submenu's project list, fetched lazily
  // the first time the submenu opens (mirrors useAcceptanceProjectMenuItem).
  const { data: options, error: optionsError } = useClientDataSWR(
    bindOptionsRequested ? PROJECT_OPTIONS_KEY : null,
    () => projectService.listAll(),
    { revalidateOnFocus: false },
  );

  if (!workingDirectory) return null;

  // `findProjectByWorkingDirectory` resolves to the bound project row itself
  // (or null when the directory is not yet bound to any project).
  const project = data ?? null;
  const actionType = getDirectoryProjectActionType({ isLoading, project, requested });

  const bindItems: DropdownItem[] = optionsError
    ? [{ disabled: true, key: 'error', label: t('projectFromDirectory.bindLoadError') }]
    : !options
      ? [{ disabled: true, key: 'loading', label: t('projectFromDirectory.bindOptionsLoading') }]
      : options.data.length === 0
        ? [{ disabled: true, key: 'empty', label: t('projectFromDirectory.bindEmpty') }]
        : options.data.map((option) => ({
            icon: <Icon icon={Check} style={{ opacity: 0 }} />,
            key: option.id,
            label: option.name,
            onClick: async () => {
              try {
                await bindDirectory(option.id, {
                  environmentType: 'device',
                  workingDirectory,
                });
                void refreshProjectList();
                void mutate(PROJECT_OPTIONS_KEY);
              } catch (error) {
                console.error('[project:bindDirectory]', error);
              }
            },
          }));

  const handleUnbind = async () => {
    if (!project) return;
    try {
      const bindings = await listDirectories(project.id);
      // The sidebar knows the path only (no device context): unbind every
      // binding row that matches this directory, so a directory bound from
      // several environments detaches completely.
      const matches = bindings.filter((b) => b.workingDirectory === workingDirectory);
      for (const binding of matches) {
        await unbindDirectory(binding.id);
      }
      void refreshProjectList();
    } catch (error) {
      console.error('[project:unbindDirectory]', error);
    }
  };

  const items: DropdownItem[] =
    actionType === 'loading'
      ? [
          {
            disabled: true,
            icon: <Icon spin icon={LoaderCircle} />,
            key: 'loading',
            label: t('projectFromDirectory.loading'),
          },
        ]
      : actionType === 'view' && project
        ? [
            {
              icon: <Icon icon={Eye} />,
              key: 'view',
              label: t('projectFromDirectory.view', { name: project.name }),
              onClick: () => navigate(`/project/${project.slug ?? project.id}`),
            },
            {
              danger: true,
              icon: <Icon icon={FolderMinus} />,
              key: 'unbind',
              label: t('projectFromDirectory.unbind'),
              onClick: () => void handleUnbind(),
            },
          ]
        : [
            {
              icon: <Icon icon={FolderPlus} />,
              key: 'create',
              label: t('projectFromDirectory.create'),
              onClick: () =>
                openCreateProjectModal({
                  initialName: getFolderName(workingDirectory),
                  onCreated: (created) => {
                    void refreshProjectList();
                    navigate(`/project/${created.slug ?? created.id}`);
                  },
                  bindings: [{ environmentType: 'device', workingDirectory }],
                }),
            },
            {
              children: bindItems,
              icon: <Icon icon={FolderInput} />,
              key: 'bind',
              label: t('projectFromDirectory.bind'),
              onOpenChange: (open) => {
                if (open) setBindOptionsRequested(true);
              },
            },
          ];

  return (
    <DropdownMenu
      items={items}
      placement={'bottomRight'}
      onOpenChange={(open) => {
        if (open) setRequested(true);
      }}
    >
      <ActionIcon icon={MoreHorizontal} size={'small'} title={t('projectFromDirectory.actions')} />
    </DropdownMenu>
  );
});

DirectoryProjectActions.displayName = 'DirectoryProjectActions';

export default DirectoryProjectActions;
