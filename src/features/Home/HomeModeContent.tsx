import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { TaskStatus } from '@lobechat/types';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { HashIcon, ListTodoIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { type InboxTopic, useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { recentService } from '@/services/recent';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import GroupBlock from './components/GroupBlock';
import { homeType } from './components/homeType';
import RunningGlyph from './components/RunningGlyph';
import EmptySuggestions from './EmptySuggestions';
import { resolveHomeChatContentState } from './homeChatContentState';
import { resolveHomeTopicSections } from './homeTopicSections';
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

const TASK_STATUSES = new Set<TaskStatus>([
  'backlog',
  'canceled',
  'completed',
  'failed',
  'paused',
  'running',
  'scheduled',
]);
const HOME_TOPIC_RECENT_LIMIT = 9;

const normalizeTaskStatus = (status: string): TaskStatus =>
  TASK_STATUSES.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

const isRoutableTopic = (topic: InboxTopic): topic is InboxTopic & { agentId: string } =>
  Boolean(topic.agentId);

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

const TaskContent = memo(() => {
  const { t } = useTranslation('home');
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  // Home is an overview, not a continuation of the Task page's last-used
  // filter. It must always show the complete task set.
  const tasksSWR = useFetchTaskList({ allAgents: true, visibility: 'all' });
  const tasks = useTaskStore(taskListSelectors.taskList);
  const tasksInit = useTaskStore(taskListSelectors.isTaskListInit);

  return (
    <GroupBlock count={tasks.length || undefined} title={t('dashboard.task.title')}>
      {tasksSWR.error && !tasksInit ? (
        <AsyncError error={tasksSWR.error} variant={'inline'} onRetry={tasksSWR.mutate} />
      ) : !tasksInit ? (
        <LoadingRows icon={ListTodoIcon} />
      ) : tasks.length === 0 ? (
        <Text className={styles.empty}>{t('dashboard.task.empty')}</Text>
      ) : (
        <Flexbox gap={4}>
          {tasks.slice(0, 8).map((task) => (
            <Row
              description={task.description || task.identifier}
              href={taskDetailPath(task.identifier)}
              icon={<TaskStatusIcon size={16} status={normalizeTaskStatus(task.status)} />}
              key={task.identifier}
              title={task.name || task.identifier}
            />
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
  const cacheScope = useCacheScope();
  const recentsSWR = useClientDataSWR(
    isLogin ? recentKeys.topicList(HOME_TOPIC_RECENT_LIMIT, cacheScope) : null,
    () => recentService.getAll(HOME_TOPIC_RECENT_LIMIT, ['topic']),
    { revalidateOnFocus: false },
  );

  // `RecentItem.status` is task-only — it is null for topics, so the recents
  // payload cannot say which conversation is mid-run. The rail already loads
  // that (same SWR key, so this costs no extra request).
  const inboxTopics = useHomeInboxTopics(isLogin);
  const topicRecents = useMemo(() => recentsSWR.data ?? [], [recentsSWR.data]);
  const routableRunningTopics = useMemo(
    () => inboxTopics.running.filter(isRoutableTopic),
    [inboxTopics.running],
  );
  const topicSections = useMemo(
    () => resolveHomeTopicSections(topicRecents, routableRunningTopics),
    [topicRecents, routableRunningTopics],
  );

  if (mode === 'chat') {
    const state = resolveHomeChatContentState({
      authLoaded: !!authLoaded,
      hasError: !!recentsSWR.error,
      isLogin: !!isLogin,
      recentsCount: topicRecents.length,
      recentsInit: recentsSWR.data !== undefined,
      runningCount: topicSections.running.length,
      runningResolved: inboxTopics.isInit || Boolean(inboxTopics.error),
    });

    if (state === 'empty') return <EmptySuggestions onSelect={onSuggestionSelect} />;

    return (
      <Flexbox gap={32}>
        {topicSections.running.length > 0 && (
          <GroupBlock count={topicSections.running.length} title={t('dashboard.chat.running')}>
            <Flexbox gap={4}>
              {topicSections.running.map((topic) => (
                <Row
                  href={AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id)}
                  icon={<RunningGlyph />}
                  key={topic.id}
                  title={topic.title}
                  description={
                    topic.updatedAt ? new Date(topic.updatedAt).toLocaleDateString() : null
                  }
                />
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
              <AsyncError error={recentsSWR.error} variant={'inline'} onRetry={recentsSWR.mutate} />
            ) : state === 'loading' ? (
              <LoadingRows />
            ) : (
              <Flexbox gap={4}>
                {topicSections.recent.slice(0, 8).map((item) => (
                  <Row
                    href={item.routePath}
                    icon={<Icon color={cssVar.colorTextDescription} icon={HashIcon} size={16} />}
                    key={item.id}
                    title={item.title}
                    description={
                      item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : null
                    }
                  />
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
