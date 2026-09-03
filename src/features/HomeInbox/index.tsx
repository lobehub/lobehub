import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import dayjs from 'dayjs';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useHomeUsageWidget,
  useHomeUsageWidgetActive,
} from '@/business/client/features/HomeUsageWidget';
import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AsyncError from '@/components/AsyncError';
import { BriefCardSkeleton } from '@/features/DailyBrief/BriefCardSkeleton';
import GroupBlock from '@/features/Home/components/GroupBlock';
import { homeType } from '@/features/Home/components/homeType';
import RailCard from '@/features/Home/components/RailCard';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
// Direct module import, not the feature barrel: home must not pull the whole
// acceptance workspace into its chunk for one hook.
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { goalSelectors, useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import GoalsRailCard from './GoalsRailCard';
import { filterHiddenWidgetSections } from './hiddenWidgets';
import { buildHomeGoalEntries } from './homeGoals';
import { resolveInboxBlockState } from './inboxBlockState';
import InboxBriefCard from './InboxBriefCard';
import MarkAllReadButton from './MarkAllReadButton';
import NeedsYouRailCard from './NeedsYouRailCard';
import { resolveShownNewsOffset, shouldShowNewsItemTime } from './newsDayOffset';
import NewsList from './NewsList';
import { ownsRailSections } from './railSectionPlacement';
import RunningTasksCard from './RunningTasksCard';
import { filterTopicsForInboxScope, resolveInboxScopeToggleSection } from './scopeTogglePlacement';
import { splitBriefs } from './splitBriefs';
import UnreadTopicList from './UnreadTopicList';
import { useHomeInboxTopics } from './useHomeInboxTopics';

const styles = createStaticStyles(({ css, cssVar }) => ({
  onlyMe: css`
    margin-inline-start: 8px;
    padding-inline: 5px;
    border-radius: 3px;
    background: ${cssVar.colorFillQuaternary};
  `,
  subtitle: css`
    margin-inline-start: 8px;
  `,
}));

interface InboxSection {
  /** Header action revealed on hover (GroupBlock's action slot). */
  action?: ReactNode;
  /** Keep the action visible without hover — e.g. mid-interaction day paging. */
  actionAlwaysVisible?: boolean;
  /** Trailing marker on the heading, e.g. the team-view "only mine" chip. */
  badge?: ReactNode;
  /** Section folded to its heading. Needs `onCollapsedChange` to be operable. */
  collapsed?: boolean;
  count?: number;
  key: string;
  /** Omitted when the section labels itself (the running card names its own count). */
  label?: string;
  node: ReactNode;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Section carries its own card shell — the rail renders it verbatim. */
  selfShelled?: boolean;
  subtitle?: string;
}

/**
 * The home inbox: everything the agents did while you were away, sorted by
 * whether it needs you.
 *
 * - **Goals** — the standing exception to "while you were away": goals run for
 *   days, so the ones still open (waiting on you, or working) are listed here
 *   rather than left to the agent page nobody visits mid-flight.
 * - **Needs you** — briefs blocking an agent (decide / fix). Errors sink to the
 *   bottom: a stuck decision blocks work right now, a failed run has already
 *   stopped.
 * - **Unread** — runs that finished while you were away, each showing the agent's
 *   last reply so the answer is right there.
 * - **Running** — collapsed to one line, showing who is working; a healthy run
 *   needs nothing from you.
 * - **News** — `insight` + `result` briefs (reports of finished work); read them
 *   or don't.
 *
 * **Workspace mode** adds a mine/team split, but only over the sections it can
 * honestly widen. Topics are workspace-shared, so the unread + running feeds
 * already carry every member's runs — the toggle filters them by triggerer, and
 * team view tags each row with whose it is. Briefs are per-user by a deliberate
 * ownership rule (a member never sees another's brief), so Needs-you and News
 * stay mine in both views; team view marks News as such rather than pretending.
 *
 * Sections are siblings, never nested: each names itself and carries its own
 * count, and one absent section never hides another's heading.
 */
interface HomeInboxProps {
  hideNeedsYou?: boolean;
  /** Running activity belongs in the main column above recent topics. */
  hideRunning?: boolean;
  hideUnread?: boolean;
  /**
   * Main column only: the rail is collapsed, so the sections it owns (goals,
   * news) fold into this column instead of disappearing with it.
   */
  inlineRail?: boolean;
  /** Controlled mine/team scope — lets the page share one scope across sibling sections. */
  onScopeChange?: (scope: 'mine' | 'team') => void;
  scope?: 'mine' | 'team';
  variant?: 'default' | 'main' | 'rail';
}

const HomeInbox = memo<HomeInboxProps>((props) => {
  const {
    hideNeedsYou,
    hideRunning,
    hideUnread,
    inlineRail,
    onScopeChange,
    scope: controlledScope,
    variant = 'default',
  } = props;
  const isRail = variant === 'rail';
  const isMain = variant === 'main';
  const showRailSections = ownsRailSections({ inlineRail, variant });
  const { t } = useTranslation('home');
  const { t: tCommon } = useTranslation('common');
  const isLogin = useUserStore(authSelectors.isLogin);
  const myId = useUserStore(userProfileSelectors.userId);

  // Briefs are per-user AND per-workspace rows, so the feed is read through the
  // active cache scope — a list left over from the previous workspace holds ids
  // this one cannot resolve, and every action on it would fail silently.
  const cacheScope = useCacheScope();
  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  const briefsSWR = useFetchBriefs(isLogin, cacheScope);
  const briefs = useBriefStore(briefListSelectors.briefs(cacheScope));
  const isBriefsInit = useBriefStore(briefListSelectors.isBriefsInit(cacheScope));

  // The news digest is day-scoped: it fetches only briefs *created* on the
  // viewed local day (today by default), resolved or not, with ‹ › paging into
  // earlier days. This replaces slicing news out of the unresolved feed, which
  // let week-old unread reports masquerade as "today's brief".
  const [newsDayOffset, setNewsDayOffset] = useState(0);
  // Recomputed every render on purpose (no memo): a Home left mounted across
  // local midnight must start querying the new day on its next render instead
  // of serving yesterday under a "Daily brief" label until remount.
  const newsDay = dayjs().subtract(newsDayOffset, 'day').format('YYYY-MM-DD');
  const useFetchNewsByDay = useBriefStore((s) => s.useFetchNewsByDay);
  const newsSWR = useFetchNewsByDay(isLogin === true && showRailSections, cacheScope, newsDay);
  const dayNews = newsSWR.data?.news;
  const hasEarlierNews = newsSWR.data?.hasEarlier ?? false;
  // `keepPreviousData` shows the previous day's payload while a page flip is in
  // flight, so everything the user SEES (title, empty copy, arrow gating) must
  // derive from the payload's own day — not from `newsDayOffset`, which has
  // already moved on. Otherwise a slow flip renders "Yesterday's brief" over
  // today's items. Clicks navigate relative to the shown day for the same
  // reason: WYSIWYG paging self-heals any offset/data divergence.
  const shownNewsOffset = newsSWR.data ? resolveShownNewsOffset(newsSWR.data.day) : 0;

  // Goals are the one home feed that is not about today: they run for days, so
  // the dashboard is where you check on them. Behind the same lab toggle as the
  // goal pages themselves — without it a row would navigate to a redirect.
  const goalsEnabled = useUserStore(labPreferSelectors.enableTopicAcceptance);
  const showGoals = isLogin === true && goalsEnabled && showRailSections;
  const useFetchHomeGoals = useGoalStore((s) => s.useFetchHomeGoals);
  const goalsSWR = useFetchHomeGoals(showGoals, cacheScope);
  const goals = useGoalStore(goalSelectors.homeGoals(cacheScope));
  const isGoalsInit = useGoalStore(goalSelectors.isHomeGoalsInitialized(cacheScope));
  // The goal rail reads the goal's own lifecycle state (`goals.status`), so it
  // no longer needs a separate acceptance read to decide each pile.
  const goalEntries = useMemo(
    () => (showGoals ? buildHomeGoalEntries(goals) : []),
    [goals, showGoals],
  );

  const goalsCollapsed = useGlobalStore(systemStatusSelectors.homeGoalsCollapsed);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const topics = useHomeInboxTopics(isLogin);
  const recommendationsVisible = useRecommendationsVisible();
  const hiddenWidgets = useGlobalStore(systemStatusSelectors.hiddenHomeWidgets);

  // Business-slot widget: `enabled` false while it's toggled off or its column
  // isn't on the page, so the slot implementation can skip its fetches.
  const usageActive = useHomeUsageWidgetActive();
  const usageNode = useHomeUsageWidget(
    isLogin === true && usageActive && showRailSections && !hiddenWidgets.includes('usage'),
  );

  // A team context is a workspace with more than the viewer in it. In personal
  // mode this map is empty, so `isTeam` is false and the whole mine/team layer
  // stays dark — the inbox is byte-for-byte the personal one.
  const memberProfiles = useWorkspaceMemberProfiles();
  const isTeam = memberProfiles.size > 1;

  const [internalScope, setInternalScope] = useState<'mine' | 'team'>('mine');
  const scope = controlledScope ?? internalScope;
  const setScope = onScopeChange ?? setInternalScope;
  const teamView = isTeam && scope === 'team';

  const { needsYou } = useMemo(() => splitBriefs(briefs), [briefs]);

  // Topics are already workspace-wide from the server; "mine" is the viewer's
  // own runs, "team" is everyone's. Personal mode has only the viewer's, so the
  // filter is a no-op there.
  const unreadTopics = useMemo(
    () => filterTopicsForInboxScope(topics.unread, myId, teamView),
    [teamView, topics.unread, myId],
  );
  const runningTopics = useMemo(
    () => filterTopicsForInboxScope(topics.running, myId, teamView),
    [teamView, topics.running, myId],
  );

  if (!isLogin) return null;

  const blockState = resolveInboxBlockState({
    hasError: Boolean(briefsSWR.error),
    hiddenWidgets,
    hideNeedsYou,
    isBriefsInit,
    isLoading: Boolean(briefsSWR.isLoading),
    isMain,
  });

  // The brief feed is the primary content; a first-load failure blocks the whole
  // surface. No fabricated section heading — we don't know what's under it yet.
  if (blockState === 'error') {
    return (
      <AsyncError
        error={briefsSWR.error}
        variant={'block'}
        onRetry={() => {
          void briefsSWR.mutate();
        }}
      />
    );
  }

  // First load: bare skeletons, no group heading (loading must not assert a
  // "Needs you" section that may turn out empty). Recommendations keep their own.
  if (blockState === 'skeleton') {
    return (
      <Flexbox gap={12}>
        <BriefCardSkeleton />
        <BriefCardSkeleton />
        <Recommendations variant={variant} />
      </Flexbox>
    );
  }

  // Mine/team lives at page level (governs the topic sections), so it rides on
  // the first titled section's header — the primary "Needs you", or Unread when
  // there's nothing to handle. Only shown in a team workspace.
  const scopeToggle = isTeam ? (
    <Segmented
      size={'small'}
      value={scope}
      options={[
        { label: t('inbox.scope.mine'), value: 'mine' },
        { label: t('inbox.scope.team'), value: 'team' },
      ]}
      onChange={(value) => setScope(value as 'mine' | 'team')}
    />
  ) : undefined;
  const toggleSectionKey = scopeToggle
    ? resolveInboxScopeToggleSection({
        hiddenWidgets,
        hideNeedsYou,
        hideUnread,
        needsYouCount: needsYou.length,
        preferUnread: isMain,
        unreadCount: unreadTopics.length,
      })
    : null;
  const placeToggle = (key: typeof toggleSectionKey): ReactNode =>
    key === toggleSectionKey ? scopeToggle : undefined;

  const sections: InboxSection[] = [];

  // A goal feed failure must not be silent: without this the card just vanishes,
  // which is indistinguishable from having no open goals — the one reading a
  // long-running goal surface can least afford.
  if (showGoals && goalsSWR.error && !isGoalsInit)
    sections.push({
      key: 'goals-error',
      label: t('inbox.goals.title'),
      node: (
        <AsyncError
          error={goalsSWR.error}
          variant={'inline'}
          onRetry={() => void goalsSWR.mutate()}
        />
      ),
    });

  // First: a goal is the longest-lived thing on the page, and the only one whose
  // absence from the rail leaves it with no home at all.
  if (goalEntries.length > 0)
    sections.push({
      collapsed: goalsCollapsed,
      count: goalEntries.length,
      key: 'goals',
      label: t('inbox.goals.title'),
      node: <GoalsRailCard bare={isRail} entries={goalEntries} />,
      onCollapsedChange: (next) =>
        updateSystemStatus({ homeGoalsCollapsed: next }, 'toggleHomeGoals'),
    });

  if (!isMain && !hideNeedsYou && needsYou.length > 0)
    sections.push(
      // The rail paginates instead of stacking and owns its header. Keep the
      // page-level scope control in that header alongside the pager.
      isRail
        ? {
            key: 'needsYou',
            node: <NeedsYouRailCard briefs={needsYou} scopeControl={placeToggle('needsYou')} />,
            selfShelled: true,
          }
        : {
            action: placeToggle('needsYou'),
            count: needsYou.length,
            key: 'needsYou',
            label: t('inbox.needsYou.title'),
            node: (
              <Flexbox gap={12}>
                {needsYou.map((brief) => (
                  <InboxBriefCard brief={brief} key={brief.id} />
                ))}
              </Flexbox>
            ),
          },
    );

  // A topic-feed failure must not be silent: without this the unread / running
  // sections would just vanish and the inbox would look empty-but-fine.
  if (topics.error)
    sections.push({
      key: 'topics-error',
      label: t('inbox.unread.title'),
      node: <AsyncError error={topics.error} variant={'inline'} onRetry={topics.reload} />,
    });

  if (!hideUnread && unreadTopics.length > 0)
    sections.push({
      action: placeToggle('unread'),
      count: unreadTopics.length,
      key: 'unread',
      label: t('inbox.unread.title'),
      node: (
        <UnreadTopicList
          bare={isRail}
          showAuthor={teamView}
          topics={unreadTopics}
          onFollowUpSent={topics.promoteToRunning}
        />
      ),
    });

  if (isMain) {
    if (briefsSWR.error && !isBriefsInit && !briefsSWR.isLoading) {
      sections.push({
        key: 'needsYou-error',
        label: t('inbox.needsYou.title'),
        node: (
          <AsyncError
            error={briefsSWR.error}
            variant={'inline'}
            onRetry={() => void briefsSWR.mutate()}
          />
        ),
      });
    } else if (!isBriefsInit) {
      sections.push({ key: 'needsYou-loading', node: <BriefCardSkeleton /> });
    } else if (!hideNeedsYou && needsYou.length > 0) {
      sections.push({
        action: placeToggle('needsYou'),
        count: needsYou.length,
        key: 'needsYou',
        label: t('inbox.needsYou.title'),
        node: (
          <Flexbox gap={12}>
            {needsYou.map((brief) => (
              <InboxBriefCard brief={brief} key={brief.id} />
            ))}
          </Flexbox>
        ),
      });
    }
  }

  // No title: the card already says "3 tasks running" on its own head. Keep
  // this in the main flow immediately before Recent topics; the rail is for
  // glanceable reports, not live work the user may want to open.
  if (!hideRunning && !isRail && runningTopics.length > 0)
    sections.push({
      key: 'running',
      node: <RunningTasksCard bare={isRail} running={runningTopics} showAuthor={teamView} />,
    });

  // A first-load failure of the day feed must not make the whole section
  // vanish — an absent "Daily brief" is indistinguishable from having no
  // briefs, so surface the error with a retry like the topic feed does.
  if (showRailSections && newsSWR.error && !dayNews)
    sections.push({
      key: 'news-error',
      label: t('inbox.news.title'),
      node: (
        <AsyncError
          error={newsSWR.error}
          variant={'inline'}
          onRetry={() => void newsSWR.mutate()}
        />
      ),
    });

  // Shown once the day feed has loaded, whenever there is anything to show *or*
  // anywhere to go: an empty today must still expose the pager when earlier
  // days hold briefs, and a browsed-to empty day must keep the way back.
  // Everything below renders from `shownNewsOffset` / the payload's own day —
  // see the comment at `shownNewsOffset` for why `newsDayOffset` must not be
  // used for display.
  const news = dayNews ?? [];
  const unresolvedNews = news.filter((brief) => !brief.resolvedAt);
  const showNewsSection =
    showRailSections && !!dayNews && (news.length > 0 || shownNewsOffset > 0 || hasEarlierNews);
  if (showNewsSection) {
    const newsDate = dayjs(newsSWR.data!.day);
    const newsLabel =
      shownNewsOffset === 0
        ? t('inbox.news.title')
        : shownNewsOffset === 1
          ? t('inbox.news.titleYesterday')
          : t('inbox.news.titleDay', {
              date: newsDate.format(
                tCommon(
                  newsDate.isSame(dayjs(), 'year') ? 'time.formatThisYear' : 'time.formatOtherYear',
                ),
              ),
            });

    sections.push({
      action: (
        <Flexbox horizontal align={'center'} gap={4}>
          {unresolvedNews.length > 0 && (
            <MarkAllReadButton news={unresolvedNews} onResolved={() => void newsSWR.mutate()} />
          )}
          <ActionIcon
            disabled={!hasEarlierNews}
            icon={ChevronLeftIcon}
            size={'small'}
            title={t('inbox.news.prevDay')}
            onClick={() => setNewsDayOffset(shownNewsOffset + 1)}
          />
          <ActionIcon
            disabled={shownNewsOffset === 0}
            icon={ChevronRightIcon}
            size={'small'}
            title={t('inbox.news.nextDay')}
            onClick={() => setNewsDayOffset(Math.max(0, shownNewsOffset - 1))}
          />
        </Flexbox>
      ),
      // Mid-paging (or on an empty day) the arrows are the section's only
      // controls — they must not vanish when the pointer leaves the header.
      actionAlwaysVisible: shownNewsOffset > 0 || news.length === 0,
      // Team view: News is still only mine (briefs are per-user), so say so
      // rather than let a team-scoped page imply it spans the team.
      badge: teamView && (
        <span className={cx(homeType.meta, styles.onlyMe)}>{t('inbox.scope.onlyMe')}</span>
      ),
      count: news.length || undefined,
      key: 'news',
      label: newsLabel,
      node:
        news.length === 0 ? (
          <span className={homeType.supporting}>
            {t(shownNewsOffset === 0 ? 'inbox.news.emptyToday' : 'inbox.news.emptyDay')}
          </span>
        ) : (
          <NewsList bare={isRail} news={news} showTime={shouldShowNewsItemTime(shownNewsOffset)} />
        ),
      subtitle: t('inbox.news.subtitle'),
    });
  }

  // The rail's LAST card, below even the suggestions: usage is passive
  // reference data, glanceable but never urgent, so it sits under everything
  // that reports actual work. Same shell as every other rail widget.
  const usageCard =
    usageNode &&
    (isRail ? (
      <RailCard title={t('inbox.usage.title')}>{usageNode}</RailCard>
    ) : (
      <GroupBlock title={t('inbox.usage.title')}>{usageNode}</GroupBlock>
    ));

  const visibleSections = filterHiddenWidgetSections(sections, hiddenWidgets);

  if (visibleSections.length === 0) {
    if (isMain) return null;

    if (isRail)
      return recommendationsVisible || usageCard ? (
        <Flexbox gap={12}>
          {recommendationsVisible && <Recommendations variant={'rail'} />}
          {usageCard}
        </Flexbox>
      ) : null;

    // With no titled block above it, the bare recommendations list doesn't need
    // the full section gap below the input area — offset the parent's gap so it
    // sits closer to the input.
    return (
      <>
        {recommendationsVisible && (
          <Flexbox style={{ marginBlockStart: -24 }}>
            <Recommendations />
          </Flexbox>
        )}
        {usageCard}
      </>
    );
  }

  return (
    <Flexbox gap={isRail ? 12 : 32}>
      {visibleSections.map(
        ({
          action,
          actionAlwaysVisible,
          badge,
          collapsed,
          count,
          key,
          label,
          node,
          onCollapsedChange,
          selfShelled,
          subtitle,
        }) => {
          if (selfShelled) return <Fragment key={key}>{node}</Fragment>;

          if (isRail)
            return (
              <RailCard
                action={action}
                collapsed={collapsed}
                count={count}
                key={key}
                title={
                  label && (
                    <>
                      {label}
                      {badge}
                    </>
                  )
                }
                onCollapsedChange={onCollapsedChange}
              >
                {node}
              </RailCard>
            );

          if (!label) return <Flexbox key={key}>{node}</Flexbox>;

          return (
            <GroupBlock
              action={action}
              actionAlwaysVisible={actionAlwaysVisible || key === toggleSectionKey}
              collapsed={collapsed}
              count={count}
              key={key}
              title={
                <>
                  {label}
                  {subtitle && (
                    <span className={cx(homeType.meta, styles.subtitle)}>· {subtitle}</span>
                  )}
                  {badge}
                </>
              }
              onCollapsedChange={onCollapsedChange}
            >
              {node}
            </GroupBlock>
          );
        },
      )}

      {!isMain && <Recommendations variant={variant} />}
      {usageCard}
    </Flexbox>
  );
});

export default HomeInbox;
