'use client';

import type { DropdownItem } from '@lobehub/ui/base-ui';
import Icon from '@lobehub/ui/es/Icon/index';
import { Check, FolderInput, FolderMinus, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { projectService } from '@/services/project';

import { buildAcceptanceProjectMenuState } from './acceptanceProjectOptions';

/**
 * Read and invalidation go through the same pair on purpose: `useClientDataSWR`
 * and the scoped `mutate` both run the key through `augmentKey`, so workspace
 * scoping stays symmetric. Plain `swr`'s global mutate cannot reach this cache
 * at all (the app installs a custom provider), and hand-scoping the key here
 * would double-augment it.
 */
const PROJECT_OPTIONS_KEY = ['acceptance:projectOptions'];

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
export const useAcceptanceProjectMenu = ({
  currentProjectId,
  onSelect,
  showRemove = Boolean(currentProjectId),
}: AcceptanceProjectMenuParams): AcceptanceProjectMenu => {
  const { t } = useTranslation('verify');
  const [requested, setRequested] = useState(false);

  const { data, error } = useClientDataSWR(
    requested ? PROJECT_OPTIONS_KEY : null,
    () => projectService.listAll(),
    { revalidateOnFocus: false },
  );

  const state = buildAcceptanceProjectMenuState({
    currentProjectId,
    error,
    projects: data?.data,
  });

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
          // This row's submenu is already subscribed, so nothing refetches it
          // on the next open — the new project has to be pushed into the cache.
          void mutate(PROJECT_OPTIONS_KEY);
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
