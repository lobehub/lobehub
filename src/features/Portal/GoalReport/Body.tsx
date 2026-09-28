import { Flexbox, Markdown } from '@lobehub/ui';
import { Skeleton, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { scopeGraphView } from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import Graph from '@/features/AgentGoals/ProcessControl/Graph';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { useReportChapter, useReportGraph } from './useReportGraph';

/**
 * The Goal report beside the result page. Both views read the live graph
 * snapshot, so a report rewritten after a new acceptance result replaces what
 * the panel shows instead of leaving a stale copy open.
 */

const styles = createStaticStyles(({ css }) => ({
  detour: css`
    padding-block: 10px;
    padding-inline: 12px;
    border: 1px dashed ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorWarningBg};
  `,
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
        <Markdown variant={'chat'}>{content}</Markdown>
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
  // path and the nodes it strayed onto, with the strays called out.
  const scoped = useMemo(
    () => (graph && chapter ? scopeGraphView(graph, new Set(chapter.mapNodeIds)) : undefined),
    [graph, chapter],
  );
  const highlightedIds = useMemo(() => new Set(chapter?.detourNodeIds ?? []), [chapter]);

  if (!view) return null;
  if (isLoading) return <Loading />;
  if (error && !story) return <AsyncError error={error} onRetry={() => void mutate()} />;
  if (!chapter || !scoped)
    return <Unavailable>{t('goalProcess.result.story.chapterMissing')}</Unavailable>;

  return (
    <Frame>
      <Flexbox gap={8}>
        {chapter.chapter.detours.map((detour, index) => (
          <Flexbox className={styles.detour} gap={4} key={index}>
            <Flexbox horizontal align={'center'} gap={8}>
              <Tag color={'warning'} size={'small'}>
                {t(`goalProcess.result.story.detourKind.${detour.kind}`)}
              </Tag>
              <Text weight={600}>{detour.title}</Text>
            </Flexbox>
            <Text fontSize={13}>{detour.reason}</Text>
            <Text fontSize={13} type={'secondary'}>
              {`${t('goalProcess.result.story.lesson')}：${detour.lesson}`}
            </Text>
          </Flexbox>
        ))}
      </Flexbox>
      <Text fontSize={12} type={'secondary'}>
        {t('goalProcess.result.story.mapHint')}
      </Text>
      {scoped.nodes.length > 0 && (
        <Graph
          graph={scoped}
          highlightedIds={highlightedIds}
          key={`${view.goalId}:${view.chapterIndex}`}
          onSelect={(nodeId) => drillIntoGoalNode(view.goalId, nodeId)}
        />
      )}
    </Frame>
  );
});

ChapterBody.displayName = 'GoalReportChapterBody';
