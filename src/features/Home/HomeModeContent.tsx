import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { HashIcon, ListTodoIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useHomeInboxTopic,
  useHomeRecentTopic,
  useHomeRecentTopicIds,
  useHomeRecentTopicsRequest,
  useHomeTask,
  useHomeTaskIds,
  useHomeTasksRequest,
} from '@/client-data';
import AsyncError from '@/components/AsyncError';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import GroupBlock from './components/GroupBlock';
import { homeType } from './components/homeType';
import RunningGlyph from './components/RunningGlyph';
import EmptySuggestions from './EmptySuggestions';
import { resolveHomeChatContentState } from './homeChatContentState';
import { resolveHomeTopicIdSections } from './homeTopicSections';
import type { HomeMode } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  description: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  empty: css`
    padding-block: 16px;
    color: ${cssVar.colorTextTertiary};
  `,
  row: css`
    min-width: 0;
    margin-inline: -10px;
    padding-block: 9px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusLG};

    color: inherit;
    text-decoration: none;

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  rowText: css`
    min-width: 0;
  `,
}));

interface HomeModeContentProps {
  mode: HomeMode;
  onSuggestionSelect: (prompt: string) => void;
}

interface RowProps {
  description?: ReactNode;
  href: string;
  icon: ReactNode;
  title: ReactNode;
}

const HOME_TOPIC_RECENT_LIMIT = 9;

const Row = memo<RowProps>(({ description, href, icon, title }) => (
  <WorkspaceLink className={styles.row} to={href}>
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Flexbox flex={'none'} paddingBlock={3}>
        {icon}
      </Flexbox>
      <Flexbox className={styles.rowText} gap={3}>
        <Text ellipsis className={homeType.itemTitle}>
          {title}
        </Text>
        {description && (
          <Text className={cx(homeType.supporting, styles.description)}>{description}</Text>
        )}
      </Flexbox>
    </Flexbox>
  </WorkspaceLink>
));

const LoadingRows = ({ icon = HashIcon }: { icon?: typeof HashIcon }) => (
  <Flexbox gap={1}>
    {[
      ['62%', '24%'],
      ['48%', '20%'],
      ['70%', '27%'],
    ].map(([titleWidth, descriptionWidth], index) => (
      <Flexbox aria-hidden horizontal className={styles.row} gap={12} key={index}>
        <Flexbox flex={'none'} paddingBlock={3}>
          <Icon color={cssVar.colorTextDescription} icon={icon} size={16} />
        </Flexbox>
        <Flexbox flex={1} gap={5}>
          <Skeleton.Button active size={'small'} style={{ height: 14, width: titleWidth }} />
          <Skeleton.Button active size={'small'} style={{ height: 11, width: descriptionWidth }} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

const TaskRow = memo<{ taskId: string }>(({ taskId }) => {
  const task = useHomeTask(taskId);
  if (!task) return null;

  return (
    <Row
      description={task.description || task.identifier}
      href={taskDetailPath(task.identifier)}
      icon={<TaskStatusIcon size={16} status={task.status} />}
      title={task.name || task.identifier}
    />
  );
});

const RecentTopicRow = memo<{ topicId: string }>(({ topicId }) => {
  const topic = useHomeRecentTopic(topicId);
  if (!topic) return null;

  return (
    <Row
      description={topic.updatedAt ? new Date(topic.updatedAt).toLocaleDateString() : null}
      href={topic.routePath}
      icon={<Icon color={cssVar.colorTextDescription} icon={HashIcon} size={16} />}
      title={topic.title}
    />
  );
});

const RunningTopicRow = memo<{ topicId: string }>(({ topicId }) => {
  const topic = useHomeInboxTopic(topicId);
  if (!topic?.agentId) return null;

  return (
    <Row
      description={topic.updatedAt ? new Date(topic.updatedAt).toLocaleDateString() : null}
      href={AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id)}
      icon={<RunningGlyph />}
      title={topic.title}
    />
  );
});

const TaskContent = memo(() => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const tasksQuery = useHomeTasksRequest(isLogin);
  const taskIds = useHomeTaskIds();
  const tasksInit = tasksQuery.isInitialized;

  return (
    <GroupBlock count={taskIds.length || undefined} title={t('dashboard.task.title')}>
      {tasksQuery.error && !tasksInit ? (
        <AsyncError error={tasksQuery.error} variant={'inline'} onRetry={tasksQuery.mutate} />
      ) : !tasksInit ? (
        <LoadingRows icon={ListTodoIcon} />
      ) : taskIds.length === 0 ? (
        <Text className={styles.empty}>{t('dashboard.task.empty')}</Text>
      ) : (
        <Flexbox gap={4}>
          {taskIds.slice(0, 8).map((taskId) => (
            <TaskRow key={taskId} taskId={taskId} />
          ))}
        </Flexbox>
      )}
    </GroupBlock>
  );
});

const HomeModeContent = memo<HomeModeContentProps>(({ mode, onSuggestionSelect }) => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const authLoaded = useUserStore(authSelectors.isLoaded);
  const recentsQuery = useHomeRecentTopicsRequest(isLogin, HOME_TOPIC_RECENT_LIMIT);
  const topicRecentIds = useHomeRecentTopicIds(HOME_TOPIC_RECENT_LIMIT);

  // `RecentItem.status` is task-only — it is null for topics, so the recents
  // payload cannot say which conversation is mid-run. The rail already loads
  // that through the normalized Topic records.
  const inboxTopics = useHomeInboxTopics(isLogin, null, true);
  const topicSections = useMemo(
    () => resolveHomeTopicIdSections(topicRecentIds, inboxTopics.runningIds),
    [inboxTopics.runningIds, topicRecentIds],
  );

  if (mode === 'chat') {
    const state = resolveHomeChatContentState({
      authLoaded: !!authLoaded,
      hasError: !!recentsQuery.error,
      isLogin: !!isLogin,
      recentsCount: topicRecentIds.length,
      recentsInit: recentsQuery.isInitialized,
      runningCount: topicSections.running.length,
      runningResolved: inboxTopics.isInit || Boolean(inboxTopics.error),
    });

    if (state === 'empty') return <EmptySuggestions onSelect={onSuggestionSelect} />;

    return (
      <Flexbox gap={32}>
        {topicSections.running.length > 0 && (
          <GroupBlock count={topicSections.running.length} title={t('dashboard.chat.running')}>
            <Flexbox gap={4}>
              {topicSections.running.map((topicId) => (
                <RunningTopicRow key={topicId} topicId={topicId} />
              ))}
            </Flexbox>
          </GroupBlock>
        )}

        {(state !== 'ready' || topicSections.recent.length > 0) && (
          <GroupBlock
            count={topicSections.recent.length || undefined}
            title={t('dashboard.chat.recents')}
          >
            {state === 'error' ? (
              <AsyncError
                error={recentsQuery.error}
                variant={'inline'}
                onRetry={recentsQuery.mutate}
              />
            ) : state === 'loading' ? (
              <LoadingRows />
            ) : (
              <Flexbox gap={4}>
                {topicSections.recent.slice(0, 8).map((topicId) => (
                  <RecentTopicRow key={topicId} topicId={topicId} />
                ))}
              </Flexbox>
            )}
          </GroupBlock>
        )}
      </Flexbox>
    );
  }

  if (!isLogin) return null;

  if (mode === 'task') {
    return <TaskContent />;
  }

  return null;
});

export default HomeModeContent;
