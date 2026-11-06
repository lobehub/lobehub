import { getFlowRoundViews } from '@/features/Acceptance/Viewer/Flow/flowNavigation';
import type { AcceptanceBundle } from '@/services/verify';

import type { BoardModel } from '../model';
import type { JourneyView } from './flow';

export const acceptanceJourneyView = (
  board: BoardModel,
  bundle: Pick<AcceptanceBundle, 'flows' | 'rounds'>,
): JourneyView | undefined => {
  const frameByNode = new Map(
    board.journeyFrames.flatMap((f) => (f.flowNodeId ? [[f.flowNodeId, f.id] as const] : [])),
  );
  if (!frameByNode.size) return;

  const views = getFlowRoundViews(bundle.flows, bundle.rounds).filter((view) =>
    view.version.nodes.some((node) => frameByNode.has(node.nodeKey)),
  );
  const view = views.find((v) => v.roundIndex !== undefined) ?? views[0];
  if (!view) return;

  const nodeByFrame = new Map([...frameByNode].map(([node, frame]) => [frame, node]));
  const edgeByKey = new Map(view.version.edges.map((edge) => [edge.edgeKey, edge.id]));
  const arrowEdge = new Map(
    board.journeyArrows.flatMap((a) =>
      a.flowEdgeId && edgeByKey.has(a.flowEdgeId) ? [[a.id, edgeByKey.get(a.flowEdgeId)!]] : [],
    ),
  );

  return {
    edgeOf: (arrowId) => arrowEdge.get(arrowId),
    frameOf: (nodeKey) => frameByNode.get(nodeKey),
    nodeOf: (frameId) => nodeByFrame.get(frameId),
    run: view.run,
    version: view.version,
  };
};
