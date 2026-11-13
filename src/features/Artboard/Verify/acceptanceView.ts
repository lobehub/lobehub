import { getFlowRoundViews } from '@/features/Acceptance/Viewer/Flow/flowNavigation';
import type { AcceptanceBundle } from '@/services/verify';

import type { BoardModel } from '../model';
import type { JourneyView } from './flow';

export const acceptanceJourneyView = (
  board: BoardModel,
  bundle: Pick<AcceptanceBundle, 'flows' | 'rounds'>,
): JourneyView | undefined => {
  const boardByNode = new Map(
    board.journeyBoards.flatMap((b) => (b.flowNodeId ? [[b.flowNodeId, b.id] as const] : [])),
  );
  if (!boardByNode.size) return;

  const views = getFlowRoundViews(bundle.flows, bundle.rounds).filter((view) =>
    view.version.nodes.some((node) => boardByNode.has(node.nodeKey)),
  );
  const view = views.find((v) => v.roundIndex !== undefined) ?? views[0];
  if (!view) return;

  const nodeByBoard = new Map([...boardByNode].map(([node, id]) => [id, node]));

  return {
    boardOf: (nodeKey) => boardByNode.get(nodeKey),
    nodeOf: (boardId) => nodeByBoard.get(boardId),
    run: view.run,
    version: view.version,
  };
};
