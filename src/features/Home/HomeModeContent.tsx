import type { TaskStatus } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import type { FlexboxProps } from '@lobehub/ui';
import { Avatar, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { HashIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AsyncError from '@/components/AsyncError';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import HomeInbox from '@/features/HomeInbox';
import AuthorChip from '@/features/HomeInbox/AuthorChip';
import { filterTopicsForInboxScope } from '@/features/HomeInbox/scopeTogglePlacement';
import { splitBriefs } from '@/features/HomeInbox/splitBriefs';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import Recommendations from '@/features/Recommendations';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { type RecentItem } from '@/server/routers/lambda/recent';
import { recentService } from '@/services/recent';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { markdownToTxt } from '@/utils/markdownToTxt';

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
  /**
   * The rail is folded away, so this column carries the sections it owns: what
   * is in flight and what happened stay above the recent topics, and the
   * suggestions — nothing that happened, only what you could do — land after.
   */
  inlineRail?: boolean;
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
export const HOME_TOPIC_RECENT_LIMIT = 15;

export const resolveRecentsBadgeCount = (fetched: number, shown: number): number | undefined =>
  Math.min(fetched, shown) || undefined;

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

const RecentTopicRow = memo<{ showAuthor?: boolean; topic: RecentItem }>(
  ({ showAuthor, topic }) => {
    const agent = useAgentDisplayMeta(topic.agentId);
    const raw = topic.description?.trim() || topic.lastAssistantMessage?.trim();
    // The snippet is raw markdown (a user note or the last assistant reply);
    // rendered as one plain line, its syntax markers are just noise.
    const description = useMemo(
      () => (raw ? markdownToTxt(raw).replaceAll(/\s+/g, ' ').trim() : undefined),
      [raw],
    );

    return (
      <Row
        description={description}
        href={topic.routePath}
        title={topic.title}
        icon={
          agent ? (
            <Avatar
              avatar={agent.avatar}
              background={agent.backgroundColor}
              className={styles.topicAvatar}
              shape={'circle'}
              size={22}
              title={agentDisplayName(agent)}
            />
          ) : (
            <Icon color={cssVar.colorTextDescription} icon={HashIcon} size={16} />
          )
        }
        trailing={
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            {showAuthor && <AuthorChip userId={topic.userId} />}
            <Time date={topic.updatedAt} />
          </Flexbox>
        }
      />
    );
  },
);

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
  const tasksTotal = useTaskStore(taskListSelectors.taskListTotal);
  const tasksInit = useTaskStore(taskListSelectors.isTaskListInit);
  const taskCount = useGlobalStore(systemStatusSelectors.homeTaskCount);

  return (
    <GroupBlock count={tasksTotal || undefined} title={t('dashboard.task.title')}>
      {tasksSWR.error && !tasksInit ? (
        <AsyncError error={tasksSWR.error} variant={'inline'} onRetry={tasksSWR.mutate} />
      ) : !tasksInit ? (
        <LoadingRows avatarSize={16} />
      ) : tasks.length === 0 ? (
        <Text className={styles.empty}>{t('dashboard.task.empty')}</Text>
      ) : (
        <Flexbox gap={4}>
          {tasks.slice(0, taskCount).map((task) => (
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

const HomeModeContent = memo<HomeModeContentProps>(({ inlineRail, mode, onSuggestionSelect }) => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const authLoaded = useUserStore(authSelectors.isLoaded);
  const myId = useUserStore(userProfileSelectors.userId);
  const recentsCount = useGlobalStore(systemStatusSelectors.homeRecentsCount);
  const cacheScope = useCacheScope();

  // One page-level mine/team scope, shared by the inbox sections and Recent
  // topics. In personal mode the member map is empty, `isTeam` stays false and
  // the whole layer is inert.
  const memberProfiles = useWorkspaceMemberProfiles();
  const isTeam = memberProfiles.size > 1;
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const teamView = isTeam && scope === 'team';

  // Workspace topics are shared, so "mine" must be narrowed server-side —
  // client-filtering the top N of a team-wide feed could starve out the
  // viewer's own topics entirely.
  const recentsSWR = useClientDataSWR(
    isLogin
      ? recentKeys.topicList(HOME_TOPIC_RECENT_LIMIT, cacheScope, teamView ? 'team' : 'mine')
      : null,
    () => recentService.getAll(HOME_TOPIC_RECENT_LIMIT, ['topic'], true, !teamView),
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
  const briefsSWR = useFetchBriefs(isLogin, cacheScope);
  const briefs = useBriefStore(briefListSelectors.briefs(cacheScope));
  const briefsInit = useBriefStore(briefListSelectors.isBriefsInit(cacheScope));
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

    // The empty short-circuit predates the fold-in: with the rail open it only
    // skips the main column's own blocks, while news and suggestions live on in
    // the rail. Folded, it would swallow them too — news needs no activity to
    // exist. Mirror the expanded page instead: suggestions first, then whatever
    // folded in (both sections render null when there is nothing to carry).
    if (state === 'empty') {
      if (!inlineRail) return <EmptySuggestions onSelect={onSuggestionSelect} />;

      return (
        <Flexbox gap={32}>
          <EmptySuggestions onSelect={onSuggestionSelect} />
          <HomeInbox inlineRail variant={'main'} />
          <Recommendations variant={'main'} />
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={32}>
        <HomeInbox
          inlineRail={inlineRail}
          scope={scope}
          variant={'main'}
          onScopeChange={setScope}
        />
        {(state !== 'ready' || topicRecents.length > 0) && (
          <GroupBlock
            actionAlwaysVisible
            count={resolveRecentsBadgeCount(topicRecents.length, recentsCount)}
            title={t('dashboard.chat.recents')}
            action={
              isTeam ? (
                <Segmented
                  size={'small'}
                  value={scope}
                  options={[
                    { label: t('inbox.scope.mine'), value: 'mine' },
                    { label: t('inbox.scope.team'), value: 'team' },
                  ]}
                  onChange={(value) => setScope(value as 'mine' | 'team')}
                />
              ) : undefined
            }
          >
            {state === 'error' ? (
              <AsyncError error={recentsSWR.error} variant={'inline'} onRetry={recentsSWR.mutate} />
            ) : state === 'loading' ? (
              <LoadingRows withTime />
            ) : (
              <Flexbox gap={4}>
                {topicRecents.slice(0, recentsCount).map((item) => (
                  <RecentTopicRow key={item.id} showAuthor={teamView} topic={item} />
                ))}
              </Flexbox>
            )}
          </GroupBlock>
        )}
        {inlineRail && <Recommendations variant={'main'} />}
      </Flexbox>
    );
  }

  if (!isLogin) return null;

  if (mode === 'task') {
    if (!inlineRail) return <TaskContent />;

    // The rail's sections sit beside task mode while it is open, so a folded
    // rail must not take them away here either: in flight and what happened
    // above the task list, suggestions after it. Unread and needs-you stay
    // hidden — task mode never surfaces them, folded or not.
    return (
      <Flexbox gap={32}>
        <HomeInbox hideNeedsYou hideUnread inlineRail variant={'main'} />
        <TaskContent />
        <Recommendations variant={'main'} />
      </Flexbox>
    );
  }

  return null;
});

export default HomeModeContent;
