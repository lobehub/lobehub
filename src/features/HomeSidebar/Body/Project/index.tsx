'use client';

import { AccordionItem, ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { ArrowRightIcon, PlusIcon, SquareKanbanIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavItem from '@/features/NavPanel/components/NavItem';
import { openCreateProjectModal } from '@/features/Projects/CreateProjectModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCurrentProjectList, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

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
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline="8px 4px"
      action={
        <ActionIcon
          icon={ArrowRightIcon}
          size="small"
          title={t('list.viewAll')}
          onClick={() => navigate('/projects')}
        />
      }
      title={
        <Text ellipsis fontSize={12} type="secondary" weight={500}>
          {t('sidebar.title')}
        </Text>
      }
    >
      {error ? (
        <AsyncError error={error} variant="inline" onRetry={() => mutate()} />
      ) : isLoading ? (
        <Flexbox align="center" padding={12}>
          <NeuralNetworkLoading size={18} />
        </Flexbox>
      ) : projects.length === 0 ? (
        <NavItem
          icon={PlusIcon}
          title={t('sidebar.emptyAction')}
          onClick={openCreateProjectModal}
        />
      ) : (
        projects.map((project) => (
          <NavItem
            icon={project.avatar || SquareKanbanIcon}
            key={project.id}
            title={project.name}
            onClick={() => navigate(`/project/${project.id}`)}
          />
        ))
      )}
    </AccordionItem>
  );
});

export default Project;
