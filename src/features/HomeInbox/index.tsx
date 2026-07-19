import { Flexbox } from '@lobehub/ui';
import { Segmented } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';
import AsyncError from '@/components/AsyncError';
import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import { BriefCardSkeleton } from '@/features/DailyBrief/BriefCardSkeleton';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

import InboxBriefCard from './InboxBriefCard';
import MarkAllReadButton from './MarkAllReadButton';
import NewsList from './NewsList';
import RunningTasksCard from './RunningTasksCard';
import { splitBriefs } from './splitBriefs';
import UnreadTopicList from './UnreadTopicList';
import { useHomeInboxTopics } from './useHomeInboxTopics';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    margin-inline-start: 6px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextQuaternary};
  `,
  onlyMe: css`
    margin-inline-start: 8px;
    padding-inline: 5px;
    border-radius: 3px;

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  subtitle: css`
    margin-inline-start: 8px;
    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface InboxSection {
  /** Header action revealed on hover (GroupBlock's action slot). */
  action?: ReactNode;
  key: string;
  node: ReactNode;
  /** Omitted when the section labels itself (the running card names its own count). */
  title?: ReactNode;
}

/** How many are in the pile, next to what the pile is. */
const titleWithCount = (label: string, count: number, subtitle?: string): ReactNode => (
  <>
    {label}
    <span className={styles.count}>{count}</span>
    {subtitle && <span className={styles.subtitle}>· {subtitle}</span>}
  </>
);

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
const HomeInbox = memo(() => {
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
    () => (teamView ? topics.unread : topics.unread.filter((topic) => topic.userId === myId)),
    [teamView, topics.unread, myId],
  );
  const runningTopics = useMemo(
    () => (teamView ? topics.running : topics.running.filter((topic) => topic.userId === myId)),
    [teamView, topics.running, myId],
  );

  if (!isLogin) return null;

  // Both overlays open from a card in here and must outlive it — a followed-up
  // topic leaves the unread list the moment it's read.
  const overlays = (
    <>
      <DocumentPreviewModal />
      <TopicChatDrawer />
    </>
  );

  // The brief feed is the primary content; a first-load failure blocks the whole
  // surface. No fabricated section heading — we don't know what's under it yet.
  if (briefsSWR.error && !isBriefsInit && !briefsSWR.isLoading) {
    return (
      <>
        <AsyncError
          error={briefsSWR.error}
          variant={'block'}
          onRetry={() => {
            void briefsSWR.mutate();
          }}
        />
        {overlays}
      </>
    );
  }

  // First load: bare skeletons, no group heading (loading must not assert a
  // "Needs you" section that may turn out empty). Recommendations keep their own.
  if (!isBriefsInit) {
    return (
      <Flexbox gap={12}>
        <BriefCardSkeleton />
        <BriefCardSkeleton />
        <Recommendations />
        {overlays}
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
  let toggleSectionKey: string | undefined;
  const placeToggle = (key: string): ReactNode => {
    if (!scopeToggle || toggleSectionKey) return undefined;
    toggleSectionKey = key;
    return scopeToggle;
  };

  const sections: InboxSection[] = [];

  if (needsYou.length > 0)
    sections.push({
      action: placeToggle('needsYou'),
      key: 'needsYou',
      node: (
        <Flexbox gap={12}>
          {needsYou.map((brief) => (
            <InboxBriefCard brief={brief} key={brief.id} />
          ))}
        </Flexbox>
      ),
      title: titleWithCount(t('inbox.needsYou.title'), needsYou.length),
    });

  // A topic-feed failure must not be silent: without this the unread / running
  // sections would just vanish and the inbox would look empty-but-fine.
  if (topics.error)
    sections.push({
      key: 'topics-error',
      node: <AsyncError error={topics.error} variant={'inline'} onRetry={topics.reload} />,
      title: t('inbox.unread.title'),
    });

  if (unreadTopics.length > 0)
    sections.push({
      action: placeToggle('unread'),
      key: 'unread',
      node: (
        <UnreadTopicList
          showAuthor={teamView}
          topics={unreadTopics}
          onFollowUpSent={topics.promoteToRunning}
        />
      ),
      title: titleWithCount(t('inbox.unread.title'), unreadTopics.length),
    });

  // No title: the card already says "3 tasks running" on its own head.
  if (runningTopics.length > 0)
    sections.push({
      key: 'running',
      node: <RunningTasksCard running={runningTopics} showAuthor={teamView} />,
    });

  if (news.length > 0)
    sections.push({
      action: <MarkAllReadButton news={news} />,
      key: 'news',
      node: <NewsList news={news} />,
      // Team view: News is still only mine (briefs are per-user), so say so
      // rather than let a team-scoped page imply it spans the team.
      title: (
        <>
          {titleWithCount(t('inbox.news.title'), news.length, t('inbox.news.subtitle'))}
          {teamView && <span className={styles.onlyMe}>{t('inbox.scope.onlyMe')}</span>}
        </>
      ),
    });

  if (sections.length === 0) {
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
        {overlays}
      </>
    );
  }

  return (
    <Flexbox gap={32}>
      {sections.map(({ action, key, node, title }) =>
        title ? (
          <GroupBlock
            action={action}
            actionAlwaysVisible={key === toggleSectionKey}
            key={key}
            title={title}
          >
            {node}
          </GroupBlock>
        ) : (
          <Flexbox key={key}>{node}</Flexbox>
        ),
      )}

      <Recommendations />

      {overlays}
    </Flexbox>
  );
});

export default HomeInbox;
