import type { TaskStatus } from '@lobechat/types';
import type { FlexboxProps } from '@lobehub/ui';
import { Avatar, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { HashIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import HomeInbox from '@/features/HomeInbox';
import { filterTopicsForInboxScope } from '@/features/HomeInbox/scopeTogglePlacement';
import { splitBriefs } from '@/features/HomeInbox/splitBriefs';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { recentService } from '@/services/recent';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import GroupBlock from './components/GroupBlock';
import { homeType } from './components/homeType';
import Time from './components/Time';
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
    border-radius: ${cssVar.borderRadiusLG};
    color: inherit;
    text-decoration: none;
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  /**
   * Box metrics shared by a real row and its skeleton, so the placeholder
   * occupies exactly the space its content will. Kept apart from `row` because
   * the skeleton must not pick up the hover affordance — nothing to click yet.
   */
  rowBox: css`
    min-width: 0;
    margin-inline: -10px;
    padding-block: 9px;
    padding-inline: 10px;
  `,
  rowText: css`
    flex: 1;
    min-width: 0;
  `,
  topicAvatar: css`
    flex: none;
    margin-block-start: 1px;
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
  trailing?: ReactNode;
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

const Row = memo<RowProps>(({ description, href, icon, title, trailing }) => (
  <WorkspaceLink className={cx(styles.rowBox, styles.row)} to={href}>
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
      {trailing}
    </Flexbox>
  </WorkspaceLink>
));

const RecentTopicRow = memo<{ topic: RecentItem }>(({ topic }) => {
  const agent = useAgentDisplayMeta(topic.agentId);
  const description = topic.description?.trim() || topic.lastAssistantMessage?.trim();

  return (
    <Row
      description={description}
      href={topic.routePath}
      title={topic.title}
      trailing={<Time date={topic.updatedAt} />}
      icon={
        agent ? (
          <Avatar
            avatar={agent.avatar}
            background={agent.backgroundColor}
            className={styles.topicAvatar}
            shape={'circle'}
            size={22}
            title={agent.title}
          />
        ) : (
          <Icon color={cssVar.colorTextDescription} icon={HashIcon} size={16} />
        )
      }
    />
  );
});

interface SkeletonLineProps {
  /** Height of the painted band inside the line box. */
  bar: number;
  flex?: FlexboxProps['flex'];
  /** Line-height of the text role this stands in for, from {@link homeType}. */
  line: number;
  width: number | string;
}

/**
 * A skeleton bar centred in the exact line box of the text it stands in for, so
 * the row already has its final height and nothing reflows when data lands.
 */
const SkeletonLine = memo<SkeletonLineProps>(({ bar, flex, line, width }) => (
  <Flexbox align={'flex-start'} flex={flex} height={line} justify={'center'}>
    <Skeleton.Block active height={bar} width={width} />
  </Flexbox>
));

/**
 * Widths per row, shaped like the content they precede: a short name over a
 * longer sentence. Uneven rows read as "a list is coming", not as a filled block.
 */
const SKELETON_ROWS = [
  { description: '86%', title: '38%' },
  { description: '64%', title: '27%' },
  { description: '92%', title: '48%' },
];

/**
 * Loading placeholder for {@link Row}. It mirrors the real row exactly — same
 * padding, same 12px lead gap, same line boxes — and keeps every element a
 * skeleton: a concrete leading icon would read as already-loaded content and
 * then be swapped for an avatar, which is precisely the wrong promise to make.
 */
const LoadingRows = memo<{ avatarSize?: number; withTime?: boolean }>(
  ({ avatarSize = 22, withTime }) => (
    <Flexbox aria-hidden gap={4}>
      {SKELETON_ROWS.map(({ description, title }, index) => (
        <Flexbox horizontal align={'flex-start'} className={styles.rowBox} gap={12} key={index}>
          <Flexbox flex={'none'} paddingBlock={3}>
            <Skeleton.Avatar
              active
              className={styles.topicAvatar}
              shape={'circle'}
              size={avatarSize}
            />
          </Flexbox>
          <Flexbox className={styles.rowText} gap={3}>
            <SkeletonLine bar={14} line={22} width={title} />
            <SkeletonLine bar={12} line={20} width={description} />
          </Flexbox>
          {withTime && <SkeletonLine bar={10} flex={'none'} line={18} width={52} />}
        </Flexbox>
      ))}
    </Flexbox>
  ),
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
        <LoadingRows avatarSize={16} />
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
  const myId = useUserStore(userProfileSelectors.userId);
  const cacheScope = useCacheScope();
  const recentsSWR = useClientDataSWR(
    isLogin ? recentKeys.topicList(HOME_TOPIC_RECENT_LIMIT, cacheScope) : null,
    () => recentService.getAll(HOME_TOPIC_RECENT_LIMIT, ['topic'], true),
    { revalidateOnFocus: false },
  );

  const inboxTopics = useHomeInboxTopics(isLogin);
  const mineUnreadCount = useMemo(
    () => filterTopicsForInboxScope(inboxTopics.unread, myId, false).length,
    [inboxTopics.unread, myId],
  );
  const mineRunningCount = useMemo(
    () => filterTopicsForInboxScope(inboxTopics.running, myId, false).length,
    [inboxTopics.running, myId],
  );
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  const briefsSWR = useFetchBriefs(isLogin);
  const briefs = useBriefStore(briefListSelectors.briefs);
  const briefsInit = useBriefStore(briefListSelectors.isBriefsInit);
  const needsYouCount = useMemo(() => splitBriefs(briefs).needsYou.length, [briefs]);
  const topicRecents = recentsSWR.data ?? [];

  if (mode === 'chat') {
    const state = resolveHomeChatContentState({
      authLoaded: !!authLoaded,
      hasError: !!recentsSWR.error,
      isLogin: !!isLogin,
      recentsCount: topicRecents.length,
      recentsInit: recentsSWR.data !== undefined,
      activityCount: mineRunningCount + mineUnreadCount + needsYouCount,
      activityError: Boolean(inboxTopics.error || briefsSWR.error),
      activityResolved:
        (inboxTopics.isInit || Boolean(inboxTopics.error)) &&
        (briefsInit || Boolean(briefsSWR.error)),
    });

    if (state === 'empty') return <EmptySuggestions onSelect={onSuggestionSelect} />;

    return (
      <Flexbox gap={32}>
        <HomeInbox variant={'main'} />
        {(state !== 'ready' || topicRecents.length > 0) && (
          <GroupBlock count={topicRecents.length || undefined} title={t('dashboard.chat.recents')}>
            {state === 'error' ? (
              <AsyncError error={recentsSWR.error} variant={'inline'} onRetry={recentsSWR.mutate} />
            ) : state === 'loading' ? (
              <LoadingRows withTime />
            ) : (
              <Flexbox gap={4}>
                {topicRecents.slice(0, 8).map((item) => (
                  <RecentTopicRow key={item.id} topic={item} />
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
