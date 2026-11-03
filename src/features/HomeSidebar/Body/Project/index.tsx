'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { ArrowDownUpIcon, ArrowRightIcon, PlusIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { resolveProjectListState } from '@/features/Projects/projectListState';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGlobalStore } from '@/store/global';
import type { ProjectListSortBy } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useLoadedProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import SortableProjectList from './SortableProjectList';

const SORT_BYS: ProjectListSortBy[] = ['manual', 'createdAt', 'updatedAt'];

interface ProjectProps {
  itemKey: string;
}

const Project = memo<ProjectProps>(({ itemKey }) => {
  const { t } = useTranslation('project');
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const navigate = useWorkspaceAwareNavigate();
  const projects = useLoadedProjectList();
  const { error, isHydrated, isValidating, revalidate } = useProjectStore(
    (s) => s.useFetchProjectList,
  )(enabled);
  const state = resolveProjectListState({ error, isHydrated, isValidating, projects });
  const sortBy = useGlobalStore(systemStatusSelectors.projectListSortBy);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const sortMenuItems = useMemo<DropdownItem[]>(
    () =>
      SORT_BYS.map((by) => ({
        checked: sortBy === by,
        key: by,
        label: t(`sidebar.sort.${by}`),
        onCheckedChange: () => updateSystemStatus({ projectListSortBy: by }),
        type: 'checkbox' as const,
      })),
    [sortBy, t, updateSystemStatus],
  );

  if (!enabled) return null;

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Text ellipsis fontSize={12} type="secondary" weight={500}>
            {t('sidebar.title')}
          </Text>
        </AccordionTrigger>
        <div
          className={cx(
            'accordion-action',
            accordionStyles.action,
            accordionStyles.actionBorderless,
          )}
        >
          <Flexbox horizontal align="center" gap={2}>
            <DropdownMenu items={sortMenuItems} placement={'bottomRight'}>
              <ActionIcon icon={ArrowDownUpIcon} size="small" title={t('sidebar.sort.title')} />
            </DropdownMenu>
            <ActionIcon
              icon={ArrowRightIcon}
              size="small"
              title={t('list.viewAll')}
              onClick={() => navigate('/projects')}
            />
            <ActionIcon
              icon={PlusIcon}
              size="small"
              title={t('create.title')}
              onClick={() => openCreateProjectModal()}
            />
          </Flexbox>
        </div>
      </AccordionHeader>
      <AccordionPanel>
        {state === 'error' ? (
          <AsyncError error={error} variant="inline" onRetry={() => revalidate()} />
        ) : state === 'loading' ? (
          <SkeletonList rows={3} />
        ) : state === 'empty' ? (
          <NavItem
            icon={PlusIcon}
            title={t('sidebar.emptyAction')}
            onClick={() => openCreateProjectModal()}
          />
        ) : (
          projects && <SortableProjectList projects={projects} />
        )}
      </AccordionPanel>
    </AccordionItem>
  );
});

export default Project;
