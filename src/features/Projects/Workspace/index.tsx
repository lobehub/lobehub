'use client';

import { Center, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FolderKanbanIcon, SendHorizontalIcon, SparklesIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncError from '@/components/AsyncError';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { getProjectConversationStartPath } from '@/features/Projects/Layout/navigation';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCurrentProjectDetail, useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import ProjectDashboard from './ProjectDashboard';

const styles = createStaticStyles(({ css }) => ({
  composer: css`
    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: 18px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  composerFooter: css`
    padding-block: 6px 8px;
    padding-inline: 14px 8px;
  `,
  content: css`
    overflow: auto;
    width: 100%;
  `,
  intro: css`
    width: 100%;
    max-width: 760px;
  `,
  page: css`
    box-sizing: border-box;
    width: min(1060px, calc(100% - 64px));
    margin-inline: auto;
    padding-block: 42px 72px;

    @media (width <= 720px) {
      width: calc(100% - 40px);
      padding-block: 32px 48px;
    }
  `,
  prompt: css`
    cursor: pointer;

    padding-block: 5px;
    padding-inline: 10px;
    border: 0;
    border-radius: 999px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  shell: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  textarea: css`
    padding-block: 15px 8px !important;
    padding-inline: 16px !important;
    border: 0 !important;

    font-size: 15px !important;

    background: transparent !important;
    box-shadow: none !important;
  `,
}));

const ProjectWorkspace = memo(() => {
  const { t } = useTranslation('project');
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useUserStore(labPreferSelectors.enableProjects);
  const detail = useCurrentProjectDetail(projectId);
  const [message, setMessage] = useState('');
  const { error, isLoading, mutate } = useProjectStore((s) => s.useFetchProjectDetail)(projectId);

  if (!enabled) {
    return (
      <Center height={'100%'}>
        <Flexbox align={'center'} gap={12}>
          <Icon icon={FolderKanbanIcon} size={40} />
          <Text fontSize={18} weight={600}>
            {t('disabled.title')}
          </Text>
          <Button onClick={() => navigate('/settings/labs')}>{t('disabled.action')}</Button>
        </Flexbox>
      </Center>
    );
  }
  if (error) return <AsyncError error={error} variant={'page'} onRetry={() => mutate()} />;
  if (isLoading || !detail)
    return (
      <Center height={'100%'}>
        <NeuralNetworkLoading />
      </Center>
    );

  const startConversation = () => {
    const content = message.trim();
    if (!content || !projectId) return;
    navigate(getProjectConversationStartPath(projectId, content));
  };
  const prompts = [
    t('overview.prompts.summarizeProgress'),
    t('overview.prompts.planMilestone'),
    t('overview.prompts.findBlockers'),
  ];

  return (
    <Flexbox className={styles.shell} flex={1}>
      <div className={styles.content}>
        <Flexbox className={styles.page} gap={0}>
          <Flexbox className={styles.intro} gap={18}>
            <Flexbox gap={5}>
              <Text fontSize={26} weight={650}>
                {t('overview.title')}
              </Text>
              <Text type={'secondary'}>{t('overview.description')}</Text>
            </Flexbox>
            <Flexbox gap={10}>
              <Flexbox className={styles.composer}>
                <TextArea
                  autoFocus
                  autoSize={{ maxRows: 7, minRows: 3 }}
                  className={styles.textarea}
                  placeholder={t('overview.composerPlaceholder')}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter')
                      startConversation();
                  }}
                />
                <Flexbox
                  horizontal
                  align={'center'}
                  className={styles.composerFooter}
                  justify={'space-between'}
                >
                  <Flexbox horizontal align={'center'} gap={7}>
                    <Tag icon={<SparklesIcon size={12} />}>{detail.project.name}</Tag>
                    <Text fontSize={12} type={'secondary'}>
                      {t('overview.contextEnabled')}
                    </Text>
                  </Flexbox>
                  <Button
                    disabled={!message.trim()}
                    icon={SendHorizontalIcon}
                    type={'primary'}
                    onClick={startConversation}
                  />
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal gap={8} wrap={'wrap'}>
                {prompts.map((prompt) => (
                  <button
                    className={styles.prompt}
                    key={prompt}
                    type={'button'}
                    onClick={() => setMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </Flexbox>
            </Flexbox>
          </Flexbox>
          <ProjectDashboard detail={detail} projectId={projectId!} />
        </Flexbox>
      </div>
    </Flexbox>
  );
});

ProjectWorkspace.displayName = 'ProjectWorkspace';

export default ProjectWorkspace;
