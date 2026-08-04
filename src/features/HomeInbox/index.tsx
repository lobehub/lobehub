import { Flexbox } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { Fragment, memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AsyncError from '@/components/AsyncError';
import { BriefCardSkeleton } from '@/features/DailyBrief/BriefCardSkeleton';
import GroupBlock from '@/features/Home/components/GroupBlock';
import { homeType } from '@/features/Home/components/homeType';
import RailCard from '@/features/Home/components/RailCard';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import InboxBriefCard from './InboxBriefCard';
import MarkAllReadButton from './MarkAllReadButton';
import NeedsYouRailCard from './NeedsYouRailCard';
import NewsList from './NewsList';
import RunningTasksCard from './RunningTasksCard';
import { filterTopicsForInboxScope, resolveScopeToggleSection } from './scopeTogglePlacement';
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
  /** Trailing marker on the heading, e.g. the team-view "only mine" chip. */
  badge?: ReactNode;
  count?: number;
  key: string;
  /** Omitted when the section labels itself (the running card names its own count). */
  label?: string;
  node: ReactNode;
  /** Section carries its own card shell — the rail renders it verbatim. */
  selfShelled?: boolean;
  subtitle?: string;
}

/**
 * The home inbox: everything the agents did while you were away, sorted by
 * whether it needs you.
 *
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
  hideUnread?: boolean;
  variant?: 'default' | 'main' | 'rail';
}

const HomeInbox = memo<HomeInboxProps>(({ hideNeedsYou, hideUnread, variant = 'default' }) => {
  const isRail = variant === 'rail';
  const isMain = variant === 'main';
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);
  const myId = useUserStore(userProfileSelectors.userId);

  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  const briefsSWR = useFetchBriefs(isLogin);
  const briefs = useBriefStore(briefListSelectors.briefs);
  const isBriefsInit = useBriefStore(briefListSelectors.isBriefsInit);

  const topics = useHomeInboxTopics(isLogin);
  const recommendationsVisible = useRecommendationsVisible();

  // A team context is a workspace with more than the viewer in it. In personal
  // mode this map is empty, so `isTeam` is false and the whole mine/team layer
  // stays dark — the inbox is byte-for-byte the personal one.
  const memberProfiles = useWorkspaceMemberProfiles();
  const isTeam = memberProfiles.size > 1;

  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const teamView = isTeam && scope === 'team';

  const { needsYou, news } = useMemo(() => splitBriefs(briefs), [briefs]);

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

  // The brief feed is the primary content; a first-load failure blocks the whole
  // surface. No fabricated section heading — we don't know what's under it yet.
  if (!isMain && briefsSWR.error && !isBriefsInit && !briefsSWR.isLoading) {
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
  if (!isMain && !isBriefsInit) {
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
    ? resolveScopeToggleSection({
        hasNeedsYou: !hideNeedsYou && needsYou.length > 0,
        hasRunning: runningTopics.length > 0,
        hasUnread: !hideUnread && unreadTopics.length > 0,
        preferUnread: isMain,
      })
    : null;
  const placeToggle = (key: typeof toggleSectionKey): ReactNode =>
    key === toggleSectionKey ? scopeToggle : undefined;

  const sections: InboxSection[] = [];

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

  // No title: the card already says "3 tasks running" on its own head.
  if (!isMain && runningTopics.length > 0)
    sections.push({
      key: 'running',
      node: (
        <RunningTasksCard
          action={placeToggle('running')}
          bare={isRail}
          running={runningTopics}
          showAuthor={teamView}
        />
      ),
    });

  if (!isMain && news.length > 0)
    sections.push({
      action: <MarkAllReadButton news={news} />,
      // Team view: News is still only mine (briefs are per-user), so say so
      // rather than let a team-scoped page imply it spans the team.
      badge: teamView && (
        <span className={cx(homeType.meta, styles.onlyMe)}>{t('inbox.scope.onlyMe')}</span>
      ),
      count: news.length,
      key: 'news',
      label: t('inbox.news.title'),
      node: <NewsList bare={isRail} news={news} />,
      subtitle: t('inbox.news.subtitle'),
    });

  if (sections.length === 0) {
    if (isMain) return null;

    if (isRail)
      return (
        <Flexbox gap={12}>
          <Recommendations variant={'rail'} />
        </Flexbox>
      );

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
      </>
    );
  }

  return (
    <Flexbox gap={isRail ? 12 : 32}>
      {sections.map(({ action, badge, count, key, label, node, selfShelled, subtitle }) => {
        if (selfShelled) return <Fragment key={key}>{node}</Fragment>;

        if (isRail)
          return (
            <RailCard
              action={action}
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
            >
              {node}
            </RailCard>
          );

        if (!label) return <Flexbox key={key}>{node}</Flexbox>;

        return (
          <GroupBlock
            action={action}
            actionAlwaysVisible={key === toggleSectionKey}
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
          >
            {node}
          </GroupBlock>
        );
      })}

      {!isMain && <Recommendations variant={variant} />}
    </Flexbox>
  );
});

export default HomeInbox;
