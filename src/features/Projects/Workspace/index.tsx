'use client';

import { Center, Flexbox, Icon, Text, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BookOpenIcon, BotIcon, CheckSquareIcon, FolderKanbanIcon, SendIcon } from 'lucide-react';
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

const styles = createStaticStyles(({ css }) => ({
  composer: css`
    overflow: hidden;

    min-height: 180px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 20px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  composerFooter: css`
    padding-block: 10px 12px;
    padding-inline: 20px 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  content: css`
    overflow: auto;

    width: 100%;
    max-width: 920px;
    margin-inline: auto;
    padding-block: 56px;
    padding-inline: 40px;

    @media (width <= 720px) {
      padding-block: 32px;
      padding-inline: 20px;
    }
  `,
  contextItem: css`
    flex: 1;

    min-width: 180px;
    padding-block: 14px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
  `,
  prompt: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 999px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    transition:
      color ${cssVar.motionDurationMid},
      border-color ${cssVar.motionDurationMid};

    &:hover {
      border-color: ${cssVar.colorPrimaryBorder};
      color: ${cssVar.colorPrimary};
    }
  `,
  shell: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  textarea: css`
    padding: 20px !important;
    border: 0 !important;

    font-size: 16px !important;

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

  const startConversation = () => {
    const content = message.trim();
    if (!content) return;

    navigate(getProjectConversationStartPath(projectId!, content));
  };
  const prompts = [
    t('overview.prompts.planMilestone'),
    t('overview.prompts.findBlockers'),
    t('overview.prompts.summarizeProgress'),
  ];
  const contextItems = [
    {
      count: detail.tasks?.length ?? 0,
      icon: CheckSquareIcon,
      label: t('sections.tasks'),
    },
    {
      count: detail.agents?.length ?? 0,
      icon: BotIcon,
      label: t('sections.agents'),
    },
    {
      count: detail.knowledgeBases?.length ?? 0,
      icon: BookOpenIcon,
      label: t('sections.knowledgeBases'),
    },
  ];

  return (
    <Flexbox className={styles.shell} flex={1}>
      <Flexbox className={styles.content} flex={1} gap={28}>
        <Flexbox gap={10}>
          <Text fontSize={30} weight={650}>
            {t('overview.nextActionTitle')}
          </Text>
          <Text type="secondary">
            {t('overview.nextActionDescription', { name: detail.project.name })}
          </Text>
        </Flexbox>

        <Flexbox className={styles.composer}>
          <TextArea
            autoFocus
            autoSize={{ maxRows: 8, minRows: 5 }}
            className={styles.textarea}
            placeholder={t('overview.composerPlaceholder')}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') startConversation();
            }}
          />
          <Flexbox
            horizontal
            align="center"
            className={styles.composerFooter}
            justify="space-between"
          >
            <Text fontSize={12} type="secondary">
              {t('overview.sendHint')}
            </Text>
            <Button
              disabled={!message.trim()}
              icon={SendIcon}
              type="primary"
              onClick={startConversation}
            >
              {t('overview.startConversation')}
            </Button>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal gap={8} wrap="wrap">
          {prompts.map((prompt) => (
            <button
              className={styles.prompt}
              key={prompt}
              type="button"
              onClick={() => setMessage(prompt)}
            >
              {prompt}
            </button>
          ))}
        </Flexbox>

        <Flexbox gap={12}>
          <Flexbox gap={4}>
            <Text fontSize={16} weight={600}>
              {t('overview.contextTitle')}
            </Text>
            <Text fontSize={13} type="secondary">
              {detail.project.description || t('overview.noDescription')}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={12} wrap="wrap">
            {contextItems.map(({ count, icon, label }) => (
              <Flexbox
                horizontal
                align="center"
                className={styles.contextItem}
                gap={10}
                key={label}
              >
                <Icon icon={icon} size={18} />
                <Text weight={500}>{label}</Text>
                <Text style={{ marginInlineStart: 'auto' }} type="secondary">
                  {count}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default ProjectWorkspace;
