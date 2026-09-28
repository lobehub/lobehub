'use client';

import { Flexbox, Markdown } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';

import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';

import { pickFinalDeliverable } from './goalAcceptanceReport';
import type { GoalGraphView } from './goalGraphViewModel';
import { findFinalAcceptanceView } from './goalResultState';
import ResultTrail from './ResultTrail';

/**
 * 结果交付 — what a finished Goal hands over, on its own tab.
 *
 * Layered for a reviewer who reads top-down: the document the work wrote comes
 * first, read like a page rather than a card, with nothing competing for
 * attention around it. Under it, the trail of how that result was reached —
 * each step's conclusions and files together, each opening one level deeper.
 * How the Goal ran (tasks, map, activity, sign-off) lives on the 执行过程 tab.
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

  return (
    <Flexbox gap={8}>
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
