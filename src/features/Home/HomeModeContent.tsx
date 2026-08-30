import { agentDisplayName } from '@lobechat/types';
import type { FlexboxProps } from '@lobehub/ui';
import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { Avatar, Segmented, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { HashIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AsyncError from '@/components/AsyncError';
import AssigneeAvatar from '@/features/AgentTasks/features/AssigneeAvatar';
import TaskStatusIcon from '@/features/AgentTasks/features/TaskStatusIcon';
import TaskTriggerTag from '@/features/AgentTasks/features/TaskTriggerTag';
import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';
import HomeInbox from '@/features/HomeInbox';
import AuthorChip from '@/features/HomeInbox/AuthorChip';
import { useHomeInboxTopics } from '@/features/HomeInbox/useHomeInboxTopics';
import Recommendations from '@/features/Recommendations';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import {
  HOME_RECENT_TASK_STATUSES,
  useHomeBriefIds,
  useHomeBriefsRequest,
  useHomeInboxTopicIds,
  useHomeRecentTopic,
  useHomeRecentTopicIds,
  useHomeRecentTopicsRequest,
  useHomeScheduledTaskIds,
  useHomeScheduledTasksIndex,
  useHomeScheduledTasksRequest,
  useHomeTask,
  useHomeTaskIds,
  useHomeTasksIndex,
  useHomeTasksRequest,
} from '@/projection';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { markdownToTxt } from '@/utils/markdownToTxt';

import GroupBlock from './components/GroupBlock';
import { homeType } from './components/homeType';
import RunningGlyph from './components/RunningGlyph';
import Time from './components/Time';
import { isHomeWidgetHidden } from './CustomizeModal/config';
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
  blockAction: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  identifier: css`
    flex: none;
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
   * The rail is folded away, so this column carries the sections it owns: goals
   * and reports stay visible, while suggestions — nothing that happened, only
   * what you could do — land after the recent topics.
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
  /** Sits on the title's own line, after it — an identifier, a badge. */
  titleExtra?: ReactNode;
  trailing?: ReactNode;
}

/**
 * What the recent block lists: everything that is not finished work. Derived
 * from the canonical status set (not hand-listed) so a status added later shows
 * up here by default instead of silently vanishing from Home.
 */
export const RECENT_TASK_STATUSES = HOME_RECENT_TASK_STATUSES;
export const HOME_TOPIC_RECENT_LIMIT = 15;

const FLEX_MIN_WIDTH_0 = { minWidth: 0 };

export const resolveRecentsBadgeCount = (fetched: number, shown: number): number | undefined =>
  Math.min(fetched, shown) || undefined;

/**
 * The one line a task row shows under its name. `instruction` is what the task
 * was actually asked to do, so it is the line worth reading; `description` is
 * the summary that only some tasks carry. Both are markdown, and a row is one
 * line — its syntax markers are just noise here.
 *
 * A task created straight from the composer takes its name from its
 * instruction, so the two would print the same sentence twice. When they agree,
 * the row keeps the name alone rather than repeating it in a quieter colour.
 */
export const resolveTaskSummaryLine = (
  { description, instruction }: { description?: string | null; instruction?: string | null },
  title: string,
): string | undefined => {
  const raw = instruction?.trim() || description?.trim();
  if (!raw) return undefined;

  const line = markdownToTxt(raw).replaceAll(/\s+/g, ' ').trim();

  return !line || line === title.trim() ? undefined : line;
};

/**
 * Reserved width for the trailing timestamp. Relative and absolute forms differ
 * in width ("4 分钟前" vs "8月13日"), and without a shared column each row's
 * avatar drifts to wherever its own time happens to start — the right side of
 * the list reads as ragged instead of as a column.
 */
const TIME_COLUMN_WIDTH = 56;
const Row = memo<RowProps>(({ description, href, icon, title, titleExtra, trailing }) => (
  <WorkspaceLink className={cx(styles.rowBox, styles.row)} to={href}>
    <Flexbox horizontal align={'flex-start'} gap={12}>
      <Flexbox flex={'none'} paddingBlock={3}>
        {icon}
      </Flexbox>
      <Flexbox className={styles.rowText} gap={3}>
        {/* The name takes the space and truncates; anything after it keeps its
            full width, so an identifier stays readable however long the name is. */}
        <Flexbox horizontal align={'center'} gap={8} style={FLEX_MIN_WIDTH_0}>
          <Text ellipsis className={homeType.itemTitle}>
            {title}
          </Text>
          {titleExtra}
        </Flexbox>
        {description && (
          <Text className={cx(homeType.supporting, styles.description)}>{description}</Text>
        )}
      </Flexbox>
      {trailing}
    </Flexbox>
  </WorkspaceLink>
));

const RecentTopicRow = memo<{ showAuthor?: boolean; topicId: string }>(
  ({ showAuthor, topicId }) => {
    const topic = useHomeRecentTopic(topicId);
    const agent = useAgentDisplayMeta(topic?.agentId);
    const raw = topic?.description?.trim() || topic?.lastAssistantMessage?.trim();
    // The snippet is raw markdown (a user note or the last assistant reply);
    // rendered as one plain line, its syntax markers are just noise.
    const description = useMemo(
      () => (raw ? markdownToTxt(raw).replaceAll(/\s+/g, ' ').trim() : undefined),
      [raw],
    );

    if (!topic) return null;

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
            <Time date={topic.updatedAt} minWidth={TIME_COLUMN_WIDTH} />
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

/**
 * A task in the home list carries the same right-hand read as the Tasks page:
 * who runs it, when it last moved — plus how it is triggered, but only in the
 * scheduled block, where the trigger is the point. The recent block hides it:
 * the runnable schedules are filtered out of that list anyway, and the ones
 * that slip through are terminal leftovers whose schedule no longer fires, so
 * printing it would claim an automation that is not there.
 */
const TaskRow = memo<{ showTrigger?: boolean; taskId: string }>(
  ({ showTrigger = true, taskId }) => {
    const task = useHomeTask(taskId);
    const title = task?.name?.trim() || task?.identifier || '';
    const description = useMemo(
      () => (task ? resolveTaskSummaryLine(task, title) : undefined),
      [task, title],
    );

    if (!task) return null;

    return (
      <Row
        description={description}
        href={taskDetailPath(task.identifier)}
        title={title}
        icon={
          task.status === 'running' ? (
            <RunningGlyph size={16} />
          ) : (
            <TaskStatusIcon size={16} status={task.status} />
          )
        }
        // The identifier is how the task is referred to everywhere else, so it
        // belongs beside the name rather than in the sentence slot below it.
        titleExtra={
          title === task.identifier ? undefined : (
            <Text className={cx(homeType.meta, styles.identifier)}>{task.identifier}</Text>
          )
        }
        trailing={
          <Flexbox horizontal align={'center'} flex={'none'} gap={8}>
            {showTrigger && (
              <TaskTriggerTag
                automationMode={task.automationMode}
                heartbeatInterval={task.heartbeatInterval}
                schedulePattern={task.schedulePattern}
                scheduleTimezone={task.scheduleTimezone}
              />
            )}
            <AssigneeAvatar agentId={task.assigneeAgentId} size={20} />
            <Time date={task.updatedAt || task.createdAt} minWidth={TIME_COLUMN_WIDTH} />
          </Flexbox>
        }
      />
    );
  },
);

const TaskContent = memo(() => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const tasksQuery = useHomeTasksRequest(isLogin);
  const taskIds = useHomeTaskIds();
  const tasksIndex = useHomeTasksIndex();
  const tasksInit = tasksQuery.isInitialized;
  const taskCount = useGlobalStore(systemStatusSelectors.homeTaskCount);
  const shown = taskIds.slice(0, taskCount);

  return (
    <GroupBlock
      actionAlwaysVisible
      count={resolveRecentsBadgeCount(taskIds.length, taskCount)}
      title={t('dashboard.task.title')}
      // The block shows the most recent slice, so the rest needs somewhere to
      // be: the badge counts what is on screen and this carries the remainder
      // to the full list, instead of a badge claiming a total you cannot reach.
      action={
        (tasksIndex?.total ?? taskIds.length) > shown.length ? (
          <WorkspaceLink className={styles.blockAction} to={'/tasks'}>
            {t('dashboard.task.viewAll')}
          </WorkspaceLink>
        ) : undefined
      }
    >
      {tasksQuery.error && !tasksInit ? (
        <AsyncError error={tasksQuery.error} variant={'inline'} onRetry={tasksQuery.mutate} />
      ) : !tasksInit ? (
        <LoadingRows withTime avatarSize={16} />
      ) : taskIds.length === 0 ? (
        <Text className={styles.empty}>{t('dashboard.task.empty')}</Text>
      ) : (
        <Flexbox gap={4}>
          {shown.map((taskId) => (
            <TaskRow key={taskId} showTrigger={false} taskId={taskId} />
          ))}
        </Flexbox>
      )}
    </GroupBlock>
  );
});

/**
 * The tasks that run without anyone pressing anything. They are the part of the
 * task set that keeps moving while you are away, so they get their own block
 * under the recent ones instead of being scattered through a list ordered by
 * when they last happened to tick.
 */
const ScheduledTaskContent = memo(() => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const scheduledQuery = useHomeScheduledTasksRequest(isLogin);
  const scheduledIds = useHomeScheduledTaskIds();
  const scheduledIndex = useHomeScheduledTasksIndex();
  const scheduledInit = scheduledQuery.isInitialized;
  const taskCount = useGlobalStore(systemStatusSelectors.homeTaskCount);

  // Automation is opt-in and most accounts have none. An empty block would be a
  // permanent reminder of a feature you did not ask for, so the section only
  // exists once something is actually scheduled — the loading skeleton aside,
  // which has to hold its place until the answer arrives.
  //
  // A failed first fetch is NOT that case: hiding it would make an unreachable
  // list look exactly like an account with no schedules, and someone whose
  // automations are running would read a confidently incomplete page. The block
  // stays and says so, with a retry.
  const failedFirstLoad = Boolean(scheduledQuery.error) && !scheduledInit;
  if (scheduledInit && scheduledIds.length === 0) return null;

  const shown = scheduledIds.slice(0, taskCount);

  return (
    <GroupBlock
      actionAlwaysVisible
      count={failedFirstLoad ? undefined : resolveRecentsBadgeCount(scheduledIds.length, taskCount)}
      title={t('dashboard.scheduledTask.title')}
      action={
        !failedFirstLoad && (scheduledIndex?.total ?? scheduledIds.length) > shown.length ? (
          <WorkspaceLink className={styles.blockAction} to={'/tasks?collection=scheduled'}>
            {t('dashboard.task.viewAll')}
          </WorkspaceLink>
        ) : undefined
      }
    >
      {failedFirstLoad ? (
        <AsyncError
          error={scheduledQuery.error}
          variant={'inline'}
          onRetry={scheduledQuery.mutate}
        />
      ) : scheduledInit ? (
        <Flexbox gap={4}>
          {shown.map((taskId) => (
            <TaskRow key={taskId} taskId={taskId} />
          ))}
        </Flexbox>
      ) : (
        <LoadingRows withTime avatarSize={16} />
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
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);
  const recentsHidden = hiddenWidgets.includes('recents');
  const tasksHidden = hiddenWidgets.includes('tasks');
  const scheduledTasksHidden = isHomeWidgetHidden('scheduledTasks', hiddenWidgets);

  // One page-level mine/team scope, shared by the inbox sections and Recent
  // topics. In personal mode the member map is empty, `isTeam` stays false and
  // the whole layer is inert.
  const memberProfiles = useWorkspaceMemberProfiles();
  const isTeam = memberProfiles.size > 1;
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const teamView = isTeam && scope === 'team';
  const recentsView = teamView ? 'team' : 'mine';

  const recentsQuery = useHomeRecentTopicsRequest(
    isLogin && !recentsHidden,
    HOME_TOPIC_RECENT_LIMIT,
    recentsView,
  );
  const topicRecentIds = useHomeRecentTopicIds(HOME_TOPIC_RECENT_LIMIT, recentsView);

  const inboxTopics = useHomeInboxTopics(isLogin);
  const mineUnreadIds = useHomeInboxTopicIds('unread', myId);
  const mineRunningIds = useHomeInboxTopicIds('running', myId);

  const briefsQuery = useHomeBriefsRequest(isLogin);
  const briefsInit = briefsQuery.isInitialized;
  const needsYouCount = useHomeBriefIds('needsYou').length;

  if (mode === 'chat') {
    // With the recents section switched off nothing is fetched, so it reports as
    // settled-and-empty rather than perpetually loading, and the remaining
    // activity alone decides what this column is.
    const state = resolveHomeChatContentState({
      activityCount: mineRunningIds.length + mineUnreadIds.length + needsYouCount,
      activityError: Boolean(inboxTopics.error || briefsQuery.error),
      activityResolved:
        (inboxTopics.isInit || Boolean(inboxTopics.error)) &&
        (briefsInit || Boolean(briefsQuery.error)),
      authLoaded: !!authLoaded,
      hasError: !recentsHidden && !!recentsQuery.error,
      isLogin: !!isLogin,
      recentsCount: topicRecentIds.length,
      recentsInit: recentsHidden || recentsQuery.isInitialized,
    });

    // The empty short-circuit predates the fold-in: with the rail open it only
    // skips the main column's own blocks, while news and suggestions live on in
    // the rail. Folded, it would swallow them too — news needs no activity to
    // exist. Mirror the expanded page instead: suggestions first, then whatever
    // folded in (both sections render null when there is nothing to carry).
    if (state === 'empty') {
      // The starters are what the recents section shows when it has nothing to
      // list, so switching that section off takes them with it.
      const starters = recentsHidden ? null : <EmptySuggestions onSelect={onSuggestionSelect} />;

      if (!inlineRail) return starters;

      return (
        <Flexbox gap={32}>
          {starters}
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
        {!recentsHidden && (state !== 'ready' || topicRecentIds.length > 0) && (
          <GroupBlock
            actionAlwaysVisible
            count={resolveRecentsBadgeCount(topicRecentIds.length, recentsCount)}
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
              <AsyncError
                error={recentsQuery.error}
                variant={'inline'}
                onRetry={recentsQuery.mutate}
              />
            ) : state === 'loading' ? (
              <LoadingRows withTime />
            ) : (
              <Flexbox gap={4}>
                {topicRecentIds.slice(0, recentsCount).map((topicId) => (
                  <RecentTopicRow key={topicId} showAuthor={teamView} topicId={topicId} />
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
    // Recent tasks answer "what is going on"; the scheduled block answers "what
    // will happen without me" — the second question only makes sense after the
    // first, so it always sits underneath.
    //
    // No inline inset: section headers sit flush with the composer edge and the
    // folded-in inbox sections above, exactly like chat mode — row hover pills
    // overhang by design (see `rowBox`).
    const taskBlocks = (
      <Flexbox gap={32}>
        {!tasksHidden && <TaskContent />}
        {!scheduledTasksHidden && <ScheduledTaskContent />}
      </Flexbox>
    );

    if (!inlineRail) return taskBlocks;

    // The rail's sections sit beside task mode while it is open, so a folded
    // rail must not take them away here either: goals and reports above the
    // task list, suggestions after it. Unread and needs-you stay
    // hidden — task mode never surfaces them, folded or not.
    return (
      <Flexbox gap={32}>
        <HomeInbox hideNeedsYou hideUnread inlineRail variant={'main'} />
        {taskBlocks}
        <Recommendations variant={'main'} />
      </Flexbox>
    );
  }

  return null;
});

export default HomeModeContent;
