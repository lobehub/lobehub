'use client';

import { Block, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BookOpenIcon, BotIcon, CheckSquareIcon, FolderKanbanIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavItem from '@/features/NavPanel/components/NavItem';
import { getProjectAgentPath, getProjectLibraryPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;

    width: 100%;
    max-width: 1200px;
    margin-inline: auto;
    padding: 32px;
  `,
  dashboard: css`
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 16px;

    @media (width <= 900px) {
      grid-template-columns: 1fr;
    }
  `,
  resourceList: css`
    min-height: 196px;
    padding: 20px;
  `,
  shell: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
}));

const ProjectWorkspace = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const detail = useProjectStore((s) => (projectId ? s.projectDetails[projectId] : undefined));
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectDetail)(projectId);

  if (!enabled) {
    return (
      <Center height="100%">
        <Flexbox align="center" gap={12}>
          <Icon icon={FolderKanbanIcon} size={40} />
          <Text fontSize={18} weight={600}>
            {t('disabled.title')}
          </Text>
          <Button onClick={() => navigate('/settings/labs')}>{t('disabled.action')}</Button>
        </Flexbox>
      </Center>
    );
  }
  if (error) return <AsyncError error={error} variant="page" onRetry={() => mutate()} />;
  if (isLoading || !detail)
    return (
      <Center height="100%">
        <NeuralNetworkLoading />
      </Center>
    );

  const sections = [
    { icon: CheckSquareIcon, items: detail.tasks ?? [], key: 'tasks', title: t('sections.tasks') },
    { icon: BotIcon, items: detail.agents ?? [], key: 'agents', title: t('sections.agents') },
    {
      icon: BookOpenIcon,
      items: detail.knowledgeBases ?? [],
      key: 'knowledgeBases',
      title: t('sections.knowledgeBases'),
    },
  ];

  return (
    <Flexbox className={styles.shell} flex={1}>
      <Flexbox className={styles.content} flex={1} gap={24}>
        <Flexbox gap={6}>
          <Text fontSize={28} weight={650}>
            {detail.project.name}
          </Text>
          <Text type="secondary">{detail.project.description || t('overview.noDescription')}</Text>
        </Flexbox>
        <Flexbox horizontal gap={12} wrap="wrap">
          {sections.map(({ icon, items, key, title }) => (
            <Block key={key} style={{ minWidth: 220, padding: 16 }} variant="filled">
              <Flexbox gap={12}>
                <Flexbox horizontal align="center" gap={8}>
                  <Icon icon={icon} />
                  <Text weight={600}>{title}</Text>
                </Flexbox>
                <Text fontSize={28} weight={650}>
                  {items.length}
                </Text>
              </Flexbox>
            </Block>
          ))}
        </Flexbox>
        <div className={styles.dashboard}>
          <Block className={styles.resourceList} variant="filled">
            <Flexbox gap={12}>
              <Text fontSize={16} weight={600}>
                {t('overview.tasksTitle')}
              </Text>
              {(detail.tasks ?? []).length === 0 ? (
                <Flexbox align="center" flex={1} gap={10} justify="center" padding={24}>
                  <Icon icon={CheckSquareIcon} size={28} />
                  <Text type="secondary">{t('overview.tasksEmpty')}</Text>
                  <Button icon={PlusIcon} onClick={() => navigate('/tasks')}>
                    {t('overview.openTasks')}
                  </Button>
                </Flexbox>
              ) : (
                (detail.tasks ?? []).map((task) => (
                  <NavItem
                    key={task.id}
                    title={task.name || task.instruction}
                    onClick={() => navigate(`/task/${task.id}`)}
                  />
                ))
              )}
            </Flexbox>
          </Block>
          <Flexbox gap={16}>
            <Block className={styles.resourceList} variant="filled">
              <Flexbox gap={8}>
                <Text fontSize={16} weight={600}>
                  {t('sections.agents')}
                </Text>
                {(detail.agents ?? []).length === 0 ? (
                  <Text type="secondary">{t('sidebar.agentsEmpty')}</Text>
                ) : (
                  (detail.agents ?? []).map(({ agent, binding }) => (
                    <NavItem
                      description={binding.role || undefined}
                      icon={BotIcon}
                      key={agent.id}
                      title={agent.title}
                      onClick={() => navigate(getProjectAgentPath(agent.id))}
                    />
                  ))
                )}
              </Flexbox>
            </Block>
            <Block className={styles.resourceList} variant="filled">
              <Flexbox gap={8}>
                <Text fontSize={16} weight={600}>
                  {t('sections.knowledgeBases')}
                </Text>
                {(detail.knowledgeBases ?? []).length === 0 ? (
                  <Text type="secondary">{t('sidebar.librariesEmpty')}</Text>
                ) : (
                  (detail.knowledgeBases ?? []).map(({ knowledgeBase }) => (
                    <NavItem
                      icon={BookOpenIcon}
                      key={knowledgeBase.id}
                      title={knowledgeBase.name}
                      onClick={() => navigate(getProjectLibraryPath(projectId!, knowledgeBase.id))}
                    />
                  ))
                )}
              </Flexbox>
            </Block>
          </Flexbox>
        </div>
      </Flexbox>
    </Flexbox>
  );
});

export default ProjectWorkspace;
