import { Flexbox } from '@lobehub/ui';
import { CircleDot, HandIcon, Newspaper } from 'lucide-react';
import { memo, useMemo } from 'react';
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
import StatusGlyph from './StatusGlyph';
import TopicRow from './TopicRow';
import { useHomeInboxTopics } from './useHomeInboxTopics';

/**
 * The home inbox: everything the agents did while you were away, sorted by
 * whether it needs you.
 *
 * - **Needs you** — briefs blocking an agent (decide / review / fix), plus
 *   topics you haven't opened. Errors sink to the bottom of the group: a stuck
 *   decision blocks work right now, a failed run has already stopped.
 * - **Running** — collapsed to one line; a healthy run needs nothing from you.
 * - **News** — `insight` briefs; read them or don't.
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

  if (briefsSWR.error && !isBriefsInit && !briefsSWR.isLoading) {
    return (
      <GroupBlock icon={HandIcon} title={t('inbox.needsYou.title')}>
        <AsyncError
          error={briefsSWR.error}
          variant={'block'}
          onRetry={() => {
            void briefsSWR.mutate();
          }}
        />
      </GroupBlock>
    );
  }

  if (!isBriefsInit) {
    return (
      <GroupBlock icon={HandIcon} title={t('inbox.needsYou.title')}>
        <Flexbox gap={12}>
          <BriefCardSkeleton />
          <BriefCardSkeleton />
          <Recommendations />
        </Flexbox>
      </GroupBlock>
    );
  }

  const hasNeedsYou = needsYou.length > 0;
  const hasUnread = topics.unread.length > 0;
  const isEmpty = !hasNeedsYou && !hasUnread && topics.running.length === 0 && news.length === 0;

  if (isEmpty) {
    // With no titled block above it, the bare recommendations list doesn't need
    // the full section gap below the input area — offset the parent's gap so it
    // sits closer to the input.
    return recommendationsVisible ? (
      <Flexbox style={{ marginBlockStart: -24 }}>
        <Recommendations />
      </Flexbox>
    ) : null;
  }

  return (
    <Flexbox gap={32}>
      {(hasNeedsYou || hasUnread) && (
        <GroupBlock icon={HandIcon} title={t('inbox.needsYou.title')}>
          <Flexbox gap={12}>
            {needsYou.map((brief) => (
              <InboxBriefCard brief={brief} key={brief.id} />
            ))}

            {hasUnread && (
              <Flexbox gap={2} style={{ marginBlockStart: hasNeedsYou ? 4 : 0 }}>
                <GroupBlock gap={8} icon={CircleDot} title={t('inbox.unread.title')}>
                  <Flexbox>
                    {topics.unread.map((topic) => (
                      <TopicRow
                        key={topic.id}
                        leading={<StatusGlyph status={'unread'} variant={'topic'} />}
                        topic={topic}
                      />
                    ))}
                  </Flexbox>
                </GroupBlock>
              </Flexbox>
            )}
          </Flexbox>
        </GroupBlock>
      )}

      <RunningTasksCard running={topics.running} />

      {news.length > 0 && (
        <GroupBlock icon={Newspaper} title={t('inbox.news.title')}>
          <NewsList news={news} />
        </GroupBlock>
      )}

      <Recommendations />

      {/* Artifact preview + "view run" both open from a brief card — they must
          stay mounted wherever brief cards render. */}
      <DocumentPreviewModal />
      <TopicChatDrawer />
    </Flexbox>
  );
});

export default HomeInbox;
