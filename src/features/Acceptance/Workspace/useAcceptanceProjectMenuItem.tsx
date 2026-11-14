'use client';

import type { DropdownItem } from '@lobehub/ui';
import Icon from '@lobehub/ui/es/Icon/index';
import { Check, FolderInput, FolderMinus, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { type ProjectListItem, useLoadedProjectList, useProjectStore } from '@/store/project';
import { PROJECT_LIST_KEY } from '@/store/project/projection';

import { buildAcceptanceProjectMenuState } from './acceptanceProjectOptions';

interface AcceptanceProjectMenuParams {
  /** The project the acceptance is filed under, if any. */
  currentProjectId?: string | null;
  /** `null` takes the acceptance out of its project. */
  onSelect: (projectId: string | null) => void;
  /**
   * Offer the "remove from project" entry. Defaults to whether
   * `currentProjectId` is set; a multi-selection passes its own answer, since
   * a mixed pick has no single current project.
   */
  showRemove?: boolean;
}

interface AcceptanceProjectMenu {
  items: DropdownItem[];
  /** Wire to the menu's open change so projects load on first open, not mount. */
  onOpenChange: (open: boolean) => void;
}

/**
 * The "file this delivery under a project" menu contents, shared between the
 * per-row submenu and the batch bar's move dropdown.
 *
 * The projects are fetched the first time the menu opens, not on mount: a list
 * of 50 rows must not fire a project read nobody asked for.
 *
 * Creating a project is offered from inside the menu — it is the only way out
 * of the empty state, and the newly created project immediately receives the
 * delivery instead of navigating the user away from their list.
 *
 * The caller owns the write (and its toast); this hook only decides what the
 * menu offers.
 */
/**
 * The caller's projects for acceptance menus: the project store's list replica,
 * which the sidebar already keeps (and persists), synced only once `requested`.
 * A restored empty list is not "no projects" until the server confirms it.
 */
export const useAcceptanceProjectOptions = (
  requested: boolean,
): { error: unknown; projects: ProjectListItem[] | undefined } => {
  const useFetchProjectList = useProjectStore((s) => s.useFetchProjectList);
  const { error } = useFetchProjectList(requested);
  const loaded = useLoadedProjectList();
  const confirmed = useProjectStore(
    (s) => s.projectListReplica.entries[PROJECT_LIST_KEY]?.source === 'server',
  );
  const projects = loaded && (loaded.length > 0 || confirmed) ? loaded : undefined;
  // A failed background refresh keeps the last list on screen.
  return { error: projects ? undefined : error, projects };
};

export const useAcceptanceProjectMenu = ({
  currentProjectId,
  onSelect,
  showRemove = Boolean(currentProjectId),
}: AcceptanceProjectMenuParams): AcceptanceProjectMenu => {
  const { t } = useTranslation('verify');
  const [requested, setRequested] = useState(false);

  const { error, projects } = useAcceptanceProjectOptions(requested);

  const state = buildAcceptanceProjectMenuState({ currentProjectId, error, projects });

  const placeholder = (key: string, label: string): DropdownItem[] => [
    { disabled: true, key, label },
  ];

  const listItems: DropdownItem[] =
    state.type === 'error'
      ? placeholder('error', t('acceptance.workspace.project.loadError'))
      : state.type === 'loading'
        ? placeholder('loading', t('acceptance.workspace.project.loading'))
        : state.type === 'empty'
          ? placeholder('empty', t('acceptance.workspace.project.empty'))
          : state.options.map(({ id, name, selected }) => ({
              icon: <Icon icon={Check} style={{ opacity: selected ? 1 : 0 }} />,
              key: id,
              label: name,
              onClick: () => {
                if (selected) return;
                onSelect(id);
              },
            }));

  const createItem: DropdownItem = {
    icon: <Icon icon={FolderPlus} />,
    key: 'create',
    label: t('acceptance.workspace.project.create'),
    onClick: () =>
      openCreateProjectModal({
        onCreated: (project) => {
          // `createProject` already put the new project into the list replica.
          onSelect(project.id);
        },
      }),
  };

  const removeItem: DropdownItem = {
    icon: <Icon icon={FolderMinus} />,
    key: 'remove',
    label: t('acceptance.workspace.project.remove'),
    onClick: () => onSelect(null),
  };

  return {
    items: [...listItems, { type: 'divider' }, createItem, ...(showRemove ? [removeItem] : [])],
    onOpenChange: (open) => {
      if (open) setRequested(true);
    },
  };
};

/** The per-row "file under a project" submenu item, built on the shared menu. */
export const useAcceptanceProjectMenuItem = ({
  currentProjectId,
  onSelect,
}: Omit<AcceptanceProjectMenuParams, 'showRemove'>): DropdownItem => {
  const { t } = useTranslation('verify');
  const { items, onOpenChange } = useAcceptanceProjectMenu({ currentProjectId, onSelect });

  return {
    children: items,
    icon: <Icon icon={FolderInput} />,
    key: 'project',
    label: currentProjectId
      ? t('acceptance.workspace.project.move')
      : t('acceptance.workspace.project.add'),
    onOpenChange,
  };
};
