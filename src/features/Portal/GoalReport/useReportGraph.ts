import { useMemo } from 'react';

import {
  buildGoalGraphView,
  type GoalGraphView,
} from '@/features/AgentGoals/ProcessControl/goalGraphViewModel';
import {
  buildStoryChapters,
  resultTrailSource,
  type StoryChapterView,
} from '@/features/AgentGoals/ProcessControl/goalResultState';
import { goalSelectors, useGoalStore } from '@/store/goal';

/**
 * The goal graph a report view reads, shared by SWR key with the result page
 * that opened it — so the panel follows the same poll and never holds a copy
 * of the report that the page has already moved past.
 */
export const useReportGraph = (goalId?: string) => {
  const useFetchGoalGraph = useGoalStore((s) => s.useFetchGoalGraph);
  const { error, isLoading, mutate } = useFetchGoalGraph(goalId);
  const snapshot = useGoalStore(goalSelectors.goalGraph(goalId ?? ''));
  const graph = useMemo(() => (snapshot ? buildGoalGraphView(snapshot) : undefined), [snapshot]);
  const source = graph ? resultTrailSource(graph) : undefined;
  const story = source?.kind === 'story' ? source : undefined;

  return { error, graph, isLoading: isLoading && !snapshot, mutate, story };
};

export const useReportChapter = (
  graph: GoalGraphView | undefined,
  story: ReturnType<typeof useReportGraph>['story'],
  chapterIndex?: number,
): StoryChapterView | undefined =>
  useMemo(() => {
    if (!graph || !story || chapterIndex === undefined) return undefined;
    return buildStoryChapters(graph, story.metadata)[chapterIndex];
  }, [graph, story, chapterIndex]);
