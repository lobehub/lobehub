'use client';

import { Icon } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { Check, FolderClosed, Group, Waypoints } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ACCEPTANCE_LIST_SCOPES,
  ACCEPTANCE_LIST_SOURCES,
  type AcceptanceListFacets,
  type AcceptanceListFilter,
} from './acceptanceListFilter';
import type { AcceptanceGroupMode } from './groupAcceptanceList';
import { useAcceptanceProjectOptions } from './useAcceptanceProjectMenuItem';

const SCOPE_LABEL_KEYS = {
  all: 'acceptance.workspace.filters.scope.all',
  created: 'acceptance.workspace.filters.scope.created',
  participated: 'acceptance.workspace.filters.scope.participated',
} as const;

const SOURCE_LABEL_KEYS = {
  all: 'acceptance.workspace.filters.source.all',
  goal: 'acceptance.workspace.filters.source.goal',
  standalone: 'acceptance.workspace.filters.source.standalone',
  task: 'acceptance.workspace.filters.source.task',
  topic: 'acceptance.workspace.filters.source.topic',
} as const;

const checkIcon = (checked: boolean) => <Icon icon={Check} style={{ opacity: checked ? 1 : 0 }} />;

interface AcceptanceListFilterMenuParams {
  facets: AcceptanceListFacets;
  filter: AcceptanceListFilter;
  groupMode: AcceptanceGroupMode;
  /** Set when the list is hosted inside a project page — the project is fixed. */
  hostProjectId?: string;
  setFacets: (facets: AcceptanceListFacets) => void;
  setFilter: (filter: AcceptanceListFilter) => void;
  setGroupMode: (mode: AcceptanceGroupMode) => void;
}

/**
 * The list header's one filter popover: who (scope) and lifecycle (status)
 * sit flat as the two most-used answers; source, project and grouping are
 * submenus labelled with their current value, so a narrowed list still says
 * what it is narrowed to without opening anything.
 */
export const useAcceptanceListFilterMenu = ({
  facets,
  filter,
  groupMode,
  hostProjectId,
  setFacets,
  setFilter,
  setGroupMode,
}: AcceptanceListFilterMenuParams): DropdownItem[] => {
  const { t } = useTranslation('verify');

  // Projects load the first time the submenu opens — or right away when a
  // persisted project filter needs its name for the label.
  const [projectsRequested, setProjectsRequested] = useState(false);
  const { data: projectData, error: projectError } = useAcceptanceProjectOptions(
    !hostProjectId && (projectsRequested || typeof facets.projectId === 'string'),
  );
  const projects = projectData?.data;

  const withValue = (title: string, value?: string) => (value ? `${title} · ${value}` : title);

  const scopeGroup: DropdownItem = {
    children: ACCEPTANCE_LIST_SCOPES.map((scope) => ({
      icon: checkIcon(facets.scope === scope),
      key: `scope-${scope}`,
      label: t(SCOPE_LABEL_KEYS[scope]),
      onClick: () => setFacets({ ...facets, scope }),
    })),
    key: 'scope',
    label: t('acceptance.workspace.filters.scope.title'),
    type: 'group',
  };

  const statusGroup: DropdownItem = {
    children: (
      [
        ['active', t('acceptance.workspace.filters.active')],
        ['all', t('acceptance.workspace.filters.all')],
        ['completed', t('acceptance.workspace.filters.completed')],
      ] as const
    ).map(([key, label]) => ({
      icon: checkIcon(filter === key),
      key,
      label,
      onClick: () => setFilter(key),
    })),
    key: 'status',
    label: t('acceptance.workspace.filters.status'),
    type: 'group',
  };

  const sourceItem: DropdownItem = {
    children: ACCEPTANCE_LIST_SOURCES.map((source) => ({
      icon: checkIcon(facets.source === source),
      key: `source-${source}`,
      label: t(SOURCE_LABEL_KEYS[source]),
      onClick: () => setFacets({ ...facets, source }),
    })),
    icon: <Icon icon={Waypoints} />,
    key: 'source',
    label: withValue(
      t('acceptance.workspace.filters.source.title'),
      facets.source === 'all' ? undefined : t(SOURCE_LABEL_KEYS[facets.source]),
    ),
  };

  const selectedProjectName =
    facets.projectId === null
      ? t('acceptance.workspace.filters.project.none')
      : facets.projectId
        ? projects?.find((project) => project.id === facets.projectId)?.name
        : undefined;

  const projectListItems: DropdownItem[] = projectError
    ? [{ disabled: true, key: 'project-error', label: t('acceptance.workspace.project.loadError') }]
    : !projects
      ? [
          {
            disabled: true,
            key: 'project-loading',
            label: t('acceptance.workspace.project.loading'),
          },
        ]
      : projects.map((project) => ({
          icon: checkIcon(facets.projectId === project.id),
          key: `project-${project.id}`,
          label: project.name,
          onClick: () => setFacets({ ...facets, projectId: project.id }),
        }));

  const projectItem: DropdownItem = {
    children: [
      {
        icon: checkIcon(facets.projectId === undefined),
        key: 'project-all',
        label: t('acceptance.workspace.filters.project.all'),
        onClick: () => setFacets({ ...facets, projectId: undefined }),
      },
      {
        icon: checkIcon(facets.projectId === null),
        key: 'project-none',
        label: t('acceptance.workspace.filters.project.none'),
        onClick: () => setFacets({ ...facets, projectId: null }),
      },
      { type: 'divider' },
      ...projectListItems,
    ],
    icon: <Icon icon={FolderClosed} />,
    key: 'project',
    label: withValue(t('acceptance.workspace.filters.project.title'), selectedProjectName),
    onOpenChange: (open: boolean) => {
      if (open) setProjectsRequested(true);
    },
  };

  const groupItem: DropdownItem = {
    children: (
      [
        ['project', t('acceptance.workspace.groups.byProject')],
        ['status', t('acceptance.workspace.groups.byStatus')],
        ['time', t('acceptance.workspace.groups.byTime')],
        ['none', t('acceptance.workspace.groups.byNone')],
      ] as const
    ).map(([key, label]) => ({
      icon: checkIcon(groupMode === key),
      key,
      label,
      onClick: () => setGroupMode(key),
    })),
    icon: <Icon icon={Group} />,
    key: 'group-mode',
    label: t('acceptance.workspace.groups.mode'),
  };

  return [
    scopeGroup,
    statusGroup,
    { type: 'divider' },
    sourceItem,
    // Inside a project page the project is the page itself.
    ...(hostProjectId ? [] : [projectItem]),
    { type: 'divider' },
    groupItem,
  ];
};
