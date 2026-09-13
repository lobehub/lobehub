'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  Text,
} from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { ArrowRightIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ProjectItem from './ProjectItem';

interface ProjectProps {
  itemKey: string;
}

const Project = memo<ProjectProps>(({ itemKey }) => {
  const { t } = useTranslation('project');
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const navigate = useWorkspaceAwareNavigate();
  const projects = useCurrentProjectList();
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectList)(enabled);

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
          <ActionIcon
            icon={ArrowRightIcon}
            size="small"
            title={t('list.viewAll')}
            onClick={() => navigate('/projects')}
          />
        </div>
      </AccordionHeader>
      <AccordionPanel>
        {error ? (
          <AsyncError error={error} variant="inline" onRetry={() => mutate()} />
        ) : isLoading ? (
          <SkeletonList rows={3} />
        ) : projects.length === 0 ? (
          <NavItem
            icon={PlusIcon}
            title={t('sidebar.emptyAction')}
            onClick={() => openCreateProjectModal()}
          />
        ) : (
          projects.map((project) => <ProjectItem key={project.id} project={project} />)
        )}
      </AccordionPanel>
    </AccordionItem>
  );
});

export default Project;
