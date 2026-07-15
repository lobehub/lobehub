import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import TopicChatDrawer from '@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer';
import { BriefCardSkeleton } from '@/features/DailyBrief/BriefCardSkeleton';
import DocumentPreviewModal from '@/features/DocumentModal/Preview';
import Recommendations, { useRecommendationsVisible } from '@/features/Recommendations';
import GroupBlock from '@/routes/(main)/home/features/components/GroupBlock';
import { useBriefStore } from '@/store/brief';
import { briefListSelectors } from '@/store/brief/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import InboxBriefCard from './InboxBriefCard';
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
  subtitle: css`
    margin-inline-start: 8px;
    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

interface InboxSection {
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
 * - **Needs you** — briefs blocking an agent (decide / review / fix). Errors sink
 *   to the bottom: a stuck decision blocks work right now, a failed run has
 *   already stopped.
 * - **Unread** — runs that finished while you were away, each showing the agent's
 *   last reply so the answer is right there.
 * - **Running** — collapsed to one line, showing who is working; a healthy run
 *   needs nothing from you.
 * - **News** — `insight` briefs; read them or don't.
 *
 * Sections are siblings, never nested: each names itself and carries its own
 * count, and one absent section never hides another's heading.
 */
const HomeInbox = memo(() => {
  const { t } = useTranslation('home');
  const isLogin = useUserStore(authSelectors.isLogin);

  const useFetchBriefs = useBriefStore((s) => s.useFetchBriefs);
  const briefsSWR = useFetchBriefs(isLogin);
  const briefs = useBriefStore(briefListSelectors.briefs);
  const isBriefsInit = useBriefStore(briefListSelectors.isBriefsInit);

  const topics = useHomeInboxTopics(isLogin);
  const recommendationsVisible = useRecommendationsVisible();

  const { needsYou, news } = useMemo(() => splitBriefs(briefs), [briefs]);

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

  const sections: InboxSection[] = [];

  if (needsYou.length > 0)
    sections.push({
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

  if (topics.unread.length > 0)
    sections.push({
      key: 'unread',
      node: <UnreadTopicList topics={topics.unread} onFollowUpSent={topics.promoteToRunning} />,
      title: titleWithCount(t('inbox.unread.title'), topics.unread.length),
    });

  // No title: the card already says "3 tasks running" on its own head.
  if (topics.running.length > 0)
    sections.push({ key: 'running', node: <RunningTasksCard running={topics.running} /> });

  if (news.length > 0)
    sections.push({
      key: 'news',
      node: <NewsList news={news} />,
      title: titleWithCount(t('inbox.news.title'), news.length, t('inbox.news.subtitle')),
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
      {sections.map(({ key, node, title }) =>
        title ? (
          <GroupBlock key={key} title={title}>
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
