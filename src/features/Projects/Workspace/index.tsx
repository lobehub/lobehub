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
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow: auto;
    padding: 32px;
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
        <Block style={{ padding: 20 }} variant="filled">
          <Flexbox gap={12}>
            <Text fontSize={16} weight={600}>
              {t('overview.tasksTitle')}
            </Text>
            {(detail.tasks ?? []).length === 0 ? (
              <Flexbox align="center" gap={10} padding={24}>
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
      </Flexbox>
    </Flexbox>
  );
});

export default ProjectWorkspace;
