'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { Divider, Skeleton } from '@lobehub/ui/base-ui';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

import { pickFinalDeliverable } from './goalAcceptanceReport';
import GoalCriteriaResults from './GoalCriteriaResults';
import type { GoalGraphView } from './goalGraphViewModel';
import { GoalDecisionsMade, GoalUnfinished, useContinueFromResult } from './GoalResultFollowUps';
import GoalResultHeader from './GoalResultHeader';
import { findFinalAcceptanceView } from './goalResultState';
import ResultDeliverables from './ResultDeliverables';
import ResultTrail from './ResultTrail';
import { useGoalResultData } from './useGoalResultData';

/**
 * 结果交付 — what a finished Goal hands over, on its own tab.
 *
 * Layered for a reviewer who reads top-down: the first screen says where the
 * result stands, what was asked, how big the run was, and carries the sign-off.
 * Every deliverable follows in one place, with a reader to page through them.
 * Then each acceptance criterion against what the latest acceptance round
 * found, the decisions the owner made along the way, and what is still open.
 * The document the work wrote follows, read like a page rather than a card,
 * and under it the trail of how that result was reached. How the Goal ran
 * (tasks, map, activity) lives on the 执行过程 tab.
 */

const FinalDocument = ({ documentId }: { documentId: string }) => {
  // The graph carries only the document id; its content is read for the page.
  const { data: document, isLoading } = useClientDataSWR(
    portalKeys.documentHeader(documentId),
    () => documentService.getDocumentById(documentId),
  );

  if (isLoading)
    return (
      <Flexbox gap={10}>
        <Skeleton height={24} radius={4} width={'40%'} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} />
        <Skeleton height={14} radius={4} width={'70%'} />
      </Flexbox>
    );

  return <Markdown variant={'chat'}>{document?.content ?? ''}</Markdown>;
};

interface GoalResultProps {
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
}

const GoalResult = ({ graph, onSelect }: GoalResultProps) => {
  const acceptanceNodeId = findFinalAcceptanceView(graph)?.node.id ?? '';
  const deliverable = pickFinalDeliverable(graph.artifacts, acceptanceNodeId);
  const data = useGoalResultData(graph);
  const continueFromResult = useContinueFromResult(graph, data.outcomes);

  return (
    <Flexbox gap={8}>
      <Flexbox gap={32}>
        <GoalResultHeader data={data} graph={graph} onContinue={continueFromResult} />
        <ResultDeliverables
          graph={graph}
          loading={data.isLoading}
          outcomes={data.outcomes}
          primaryResourceId={deliverable?.documentId}
        />
        <GoalCriteriaResults
          error={data.error}
          loading={data.isLoading}
          outcomes={data.outcomes}
          onRetry={data.retry}
        />
        <GoalDecisionsMade graph={graph} />
        <GoalUnfinished graph={graph} outcomes={data.outcomes} onContinue={continueFromResult} />
      </Flexbox>
      <Divider style={{ marginBlock: 24 }} />
      {deliverable && (
        <>
          <FinalDocument documentId={deliverable.documentId} />
          <Divider style={{ marginBlock: 24 }} />
        </>
      )}
      <ResultTrail documentId={deliverable?.documentId} graph={graph} onSelect={onSelect} />
    </Flexbox>
  );
};

export default GoalResult;
