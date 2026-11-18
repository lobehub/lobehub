import { createStaticStyles, Flexbox, Markdown, Skeleton, Text } from '@lobehub/ui';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import Graph from '@/features/AgentGoals/ProcessControl/Graph';
import { chapterMap } from '@/features/AgentGoals/ProcessControl/Graph/chapterMap';
import DetourCallout from '@/features/AgentGoals/Report/DetourCallout';
import { useEntityMarkdown } from '@/features/EntityLink';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { useReportChapter, useReportGraph } from './useReportGraph';

/**
 * The Goal report beside the result page. Both views read the live graph
 * snapshot, so a report rewritten after a new acceptance result replaces what
 * the panel shows instead of leaving a stale copy open.
 */

const styles = createStaticStyles(({ css }) => ({
  scroll: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
}));

const Frame = ({ children }: { children: ReactNode }) => (
  <Flexbox className={styles.scroll} gap={16} padding={16}>
    {children}
  </Flexbox>
);

const Loading = () => (
  <Frame>
    <Skeleton height={20} radius={4} width={'48%'} />
    <Skeleton height={14} radius={4} />
    <Skeleton height={14} radius={4} />
    <Skeleton height={14} radius={4} width={'64%'} />
  </Frame>
);

const Unavailable = ({ children }: { children: string }) => (
  <Frame>
    <Text type={'secondary'}>{children}</Text>
  </Frame>
);

export const ReportBody = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalReportView);
  const markdownProps = useEntityMarkdown();
  const { error, isLoading, mutate, story } = useReportGraph(view?.goalId);

  if (!view) return null;
  if (isLoading) return <Loading />;
  if (error && !story) return <AsyncError error={error} onRetry={() => void mutate()} />;
  if (!story) return <Unavailable>{t('goalProcess.result.story.unavailable')}</Unavailable>;

  const content = story.report.content?.trim();

  return (
    <Frame>
      <Text fontSize={16} weight={600}>
        {story.metadata.headline}
      </Text>
      {content ? (
        <Markdown variant={'chat'} {...markdownProps}>
          {content}
        </Markdown>
      ) : (
        <Text type={'secondary'}>{t('goalProcess.result.story.reportEmpty')}</Text>
      )}
    </Frame>
  );
});

ReportBody.displayName = 'GoalReportBody';

export const ChapterBody = memo(() => {
  const { t } = useTranslation('chat');
  const view = useChatStore(chatPortalSelectors.goalReportChapterView);
  const drillIntoGoalNode = useChatStore((s) => s.drillIntoGoalNode);
  const { error, graph, isLoading, mutate, story } = useReportGraph(view?.goalId);
  const chapter = useReportChapter(graph, story, view?.chapterIndex);

  // The map reuses the exploration graph narrowed to this chapter: its main
  // path and the nodes it strayed onto, with the strays called out and joined
  // back to where they forked.
  const map = useMemo(
    () => (graph && chapter ? chapterMap(graph, chapter.mapNodeIds) : undefined),
    [graph, chapter],
  );
  const highlightedIds = useMemo(() => new Set(chapter?.detourNodeIds ?? []), [chapter]);

  if (!view) return null;
  if (isLoading) return <Loading />;
  if (error && !story) return <AsyncError error={error} onRetry={() => void mutate()} />;
  if (!chapter || !map)
    return <Unavailable>{t('goalProcess.result.story.chapterMissing')}</Unavailable>;

  return (
    <Frame>
      <Flexbox gap={8}>
        {chapter.chapter.detours.map((detour, index) => (
          <DetourCallout key={index} {...detour} />
        ))}
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('goalProcess.result.story.mapHint')}
      </Text>
      {map.graph.nodes.length > 0 && (
        <Graph
          initialShowMainline
          bridges={map.bridges}
          graph={map.graph}
          highlightedIds={highlightedIds}
          key={`${view.goalId}:${view.chapterIndex}`}
          onSelect={(nodeId) => drillIntoGoalNode(view.goalId, nodeId)}
        />
      )}
    </Frame>
  );
});

ChapterBody.displayName = 'GoalReportChapterBody';
