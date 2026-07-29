import type { TaskStatus } from '@lobechat/types';
import { Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { FileTextIcon, HashIcon, ListTodoIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useInitRecents } from '@/hooks/useInitRecents';
import type { RecentItem } from '@/server/routers/lambda/recent';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import { pageSelectors, usePageStore } from '@/store/page';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import GroupBlock from './components/GroupBlock';
import { homeType } from './components/homeType';
import RunningGlyph from './components/RunningGlyph';
import EmptySuggestions from './EmptySuggestions';
import { resolveHomeChatContentState } from './homeChatContentState';
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

const normalizeTaskStatus = (status: string): TaskStatus =>
  TASK_STATUSES.has(status as TaskStatus) ? (status as TaskStatus) : 'backlog';

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

const NoteContent = memo(() => {
  const { t } = useTranslation('home');
  const useFetchDocuments = usePageStore((s) => s.useFetchDocuments);
  const pagesSWR = useFetchDocuments();
  const pages = usePageStore(pageSelectors.getFilteredDocuments);

  return (
    <GroupBlock count={pages.length || undefined} title={t('dashboard.note.title')}>
      {pagesSWR.error && !pagesSWR.data ? (
        <AsyncError error={pagesSWR.error} variant={'inline'} onRetry={pagesSWR.mutate} />
      ) : pagesSWR.isLoading && !pagesSWR.data ? (
        <LoadingRows icon={FileTextIcon} />
      ) : pages.length === 0 ? (
        <Text className={styles.empty}>{t('dashboard.note.empty')}</Text>
      ) : (
        <Flexbox gap={4}>
          {pages.slice(0, 8).map((page) => (
            <Row
              description={page.content || t('dashboard.note.noContent')}
              href={`/page/${page.id}`}
              icon={<Icon icon={FileTextIcon} size={16} />}
              key={page.id}
              title={page.title || t('dashboard.note.untitled')}
            />
          ))}
        </Flexbox>
      )}
    </GroupBlock>
  );
});

const TaskContent = memo<{ outputs: RecentItem[] }>(({ outputs }) => {
  const { t } = useTranslation('home');
  const useFetchTaskList = useTaskStore((s) => s.useFetchTaskList);
  const tasksSWR = useFetchTaskList({ allAgents: true });
  const tasks = useTaskStore(taskListSelectors.taskList);
  const tasksInit = useTaskStore(taskListSelectors.isTaskListInit);

  return (
    <Flexbox gap={36}>
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

      {outputs.length > 0 && (
        <GroupBlock title={t('dashboard.task.outputs')}>
          <Flexbox gap={4}>
            {outputs.slice(0, 4).map((item) => (
              <Row
                href={item.routePath}
                icon={<Icon icon={FileTextIcon} size={16} />}
                key={item.id}
                title={item.title}
              />
            ))}
          </Flexbox>
        </GroupBlock>
      )}
    </Flexbox>
  );
});

const HomeModeContent = memo<HomeModeContentProps>(({ mode, onSuggestionSelect }) => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const authLoaded = useUserStore(authSelectors.isLoaded);

  const recents = useHomeStore(homeRecentSelectors.recents);
  const recentsInit = useHomeStore(homeRecentSelectors.isRecentsInit);
  const recentsSWR = useInitRecents();

  // `RecentItem.status` is task-only — it is null for topics, so the recents
  // payload cannot say which conversation is mid-run. The rail already loads
  // that (same SWR key, so this costs no extra request).
  const inboxTopics = useHomeInboxTopics(isLogin);
  const runningTopicIds = useMemo(
    () => new Set(inboxTopics.running.map((topic) => topic.id)),
    [inboxTopics.running],
  );
  const topicRecents = useMemo(() => recents.filter((item) => item.type === 'topic'), [recents]);
  const outputRecents = useMemo(
    () => recents.filter((item) => item.type === 'document'),
    [recents],
  );

  if (mode === 'chat') {
    const state = resolveHomeChatContentState({
      authLoaded: !!authLoaded,
      hasError: !!recentsSWR.error,
      isLogin: !!isLogin,
      recentsCount: topicRecents.length,
      recentsInit,
    });

    if (state === 'empty') return <EmptySuggestions onSelect={onSuggestionSelect} />;

    return (
      <GroupBlock count={topicRecents.length || undefined} title={t('dashboard.chat.recents')}>
        {state === 'error' ? (
          <AsyncError error={recentsSWR.error} variant={'inline'} onRetry={recentsSWR.mutate} />
        ) : state === 'loading' ? (
          <LoadingRows />
        ) : (
          <Flexbox gap={4}>
            {topicRecents.slice(0, 8).map((item) => (
              <Row
                description={item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : null}
                href={item.routePath}
                key={item.id}
                title={item.title}
                icon={
                  runningTopicIds.has(item.id) ? (
                    <RunningGlyph />
                  ) : (
                    <Icon color={cssVar.colorTextDescription} icon={HashIcon} size={16} />
                  )
                }
              />
            ))}
          </Flexbox>
        )}
      </GroupBlock>
    );
  }

  if (!isLogin) return null;

  if (mode === 'task') {
    return <TaskContent outputs={outputRecents} />;
  }

  return <NoteContent />;
});

export default HomeModeContent;
