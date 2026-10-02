'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { Divider, Skeleton } from '@lobehub/ui/base-ui';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useEntityMarkdown } from '@/features/EntityLink';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

import GoalAcceptanceHierarchy from './GoalAcceptanceHierarchy';
import { pickFinalDeliverable } from './goalAcceptanceReport';
import { buildAcceptanceTree } from './goalAcceptanceTree';
import GoalCriteriaResults from './GoalCriteriaResults';
import type { GoalGraphView } from './goalGraphViewModel';
import { GoalDecisionsMade, GoalUnfinished, useContinueFromResult } from './GoalResultFollowUps';
import GoalResultHeader from './GoalResultHeader';
import { findFinalAcceptanceView } from './goalResultState';
import ResultAnchorRail from './ResultAnchorRail';
import { anchorProps } from './resultAnchors';
import ResultDeliverables from './ResultDeliverables';
import ResultTrail from './ResultTrail';
import { useGoalResultData } from './useGoalResultData';

/**
 * 结果交付 — what a finished Goal hands over, on its own tab.
 *
 * Layered for a reviewer who reads top-down: the first screen is the Goal's own
 * headline, the document the work wrote leads the page as the delivery itself,
 * and the deliverables plus each acceptance criterion (against what the latest
 * acceptance round found) follow as the evidence behind it. Under them the trail
 * of how that result was reached. What the owner shaped along the way and what is
 * still open closes the page — history reads after the delivery, not before it.
 * How the Goal ran (tasks, map, activity) lives on the 执行过程 tab.
 *
 * A rail of ticks beside the scrollbar names those sections on hover and jumps
 * to them on click — see `ResultAnchorRail`.
 */

const FinalDocument = ({ documentId }: { documentId: string }) => {
  // The graph carries only the document id; its content is read for the page.
  const markdownProps = useEntityMarkdown();
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

  return (
    <Markdown variant={'chat'} {...markdownProps}>
      {document?.content ?? ''}
    </Markdown>
  );
};

interface GoalResultProps {
  graph: GoalGraphView;
  onSelect: (nodeId: string) => void;
}

const GoalResult = ({ graph, onSelect }: GoalResultProps) => {
  const { t } = useTranslation('chat');
  const rootRef = useRef<HTMLDivElement>(null);
  const acceptanceNodeId = findFinalAcceptanceView(graph)?.node.id ?? '';
  const deliverable = pickFinalDeliverable(graph.artifacts, acceptanceNodeId);
  const data = useGoalResultData(graph);
  const continueFromResult = useContinueFromResult(graph, data.outcomes);
  const acceptanceTree = useMemo(() => buildAcceptanceTree(graph), [graph]);

  return (
    <div ref={rootRef}>
      <ResultAnchorRail rootRef={rootRef} />
      <Flexbox gap={8}>
        <div {...anchorProps('overview', t('goalProcess.result.nav.overview'))}>
          <GoalResultHeader data={data} graph={graph} />
        </div>
        {deliverable && (
          <div
            {...anchorProps('document', t('goalProcess.result.nav.document'))}
            style={{ paddingBlockStart: 16 }}
          >
            <FinalDocument documentId={deliverable.documentId} />
          </div>
        )}
        <Divider style={{ marginBlock: 24 }} />
        <Flexbox gap={32}>
          <div {...anchorProps('deliverables', t('goalProcess.deliverables.title'))}>
            <ResultDeliverables
              graph={graph}
              loading={data.isLoading}
              outcomes={data.outcomes}
              primaryResourceId={deliverable?.documentId}
            />
          </div>
          <div {...anchorProps('criteria', t('goalProcess.result.criteria.title'))}>
            <GoalCriteriaResults
              error={data.error}
              loading={data.isLoading}
              outcomes={data.outcomes}
              onRetry={data.retry}
            >
              {/* Every acceptance the Goal owns, under the criteria it was judged
                  against: the standard first, then which task held up to its own. */}
              <GoalAcceptanceHierarchy
                canReview={data.canReview}
                goalId={graph.goal.id}
                tree={acceptanceTree}
              />
            </GoalCriteriaResults>
          </div>
        </Flexbox>
        <Divider style={{ marginBlock: 24 }} />
        <div {...anchorProps('trail', t('goalProcess.result.trail.title'))}>
          <ResultTrail documentId={deliverable?.documentId} graph={graph} onSelect={onSelect} />
        </div>
        <Divider style={{ marginBlock: 24 }} />
        <Flexbox gap={32}>
          <div {...anchorProps('decisions', t('goalProcess.result.decisions.title'))}>
            <GoalDecisionsMade graph={graph} />
          </div>
          <div {...anchorProps('unfinished', t('goalProcess.result.unfinished.title'))}>
            <GoalUnfinished
              graph={graph}
              outcomes={data.outcomes}
              onContinue={continueFromResult}
            />
          </div>
        </Flexbox>
      </Flexbox>
    </div>
  );
};

export default GoalResult;
