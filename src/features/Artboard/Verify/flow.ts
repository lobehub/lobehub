import type { FlowVersion } from '@/features/Acceptance/Viewer/Flow/flowNavigation';
import { getFlowNodeState } from '@/features/Acceptance/Viewer/Flow/flowNodeState';

import type { BoardModel } from '../model';

export type FlowRun = FlowVersion['runs'][number];
export type FlowNodeState = ReturnType<typeof getFlowNodeState>;

export interface JourneyView {
  boardOf: (nodeKey: string) => string | undefined;
  nodeOf: (boardId: string) => string | undefined;
  run: FlowRun | undefined;
  version: FlowVersion;
}

const foldDecisions = (board: BoardModel) => {
  const decisions = new Set(
    board.journeyBoards.filter((item) => item.type === 'decision').map((item) => item.id),
  );
  return board.journeyEdges.flatMap((edge) => {
    if (decisions.has(edge.from)) return [];
    if (!decisions.has(edge.to))
      return [
        {
          condition: edge.condition ?? undefined,
          from: edge.from,
          id: edge.id,
          to: edge.to,
          trigger: edge.label,
        },
      ];
    return board.journeyEdges
      .filter((branch) => branch.from === edge.to && !decisions.has(branch.to))
      .map((branch) => ({
        condition: branch.condition ?? branch.label,
        from: edge.from,
        id: `${edge.id}:${branch.id}`,
        to: branch.to,
        trigger: edge.label,
      }));
  });
};

export const draftJourneyView = (board: BoardModel): JourneyView | undefined => {
  const entry = board.journeyEntryId;
  const steps = board.journeyBoards.filter((item) => item.type !== 'decision');
  if (!entry || !steps.length) return;

  const edges = foldDecisions(board).map((edge) => ({
    condition: edge.condition,
    edgeKey: edge.id,
    id: edge.id,
    required: true,
    sourceNodeId: edge.from,
    sourceNodeKey: edge.from,
    targetNodeId: edge.to,
    targetNodeKey: edge.to,
    trigger: edge.trigger,
  }));
  const ids = new Set(steps.map((item) => item.id));

  const version: FlowVersion = {
    edges,
    entryNodeKey: entry,
    flowId: board.artboard.id,
    id: board.artboard.id,
    nodes: steps.map((item) => {
      const items = [
        ...(item.id === entry ? [`${item.id}:entry`] : []),
        ...edges.filter((e) => e.targetNodeKey === item.id).map((e) => `${item.id}:${e.id}`),
      ];
      const expected = item.expected ?? '';
      return {
        checkItemIds: items,
        criterionId: undefined,
        definition: { expected },
        entryRequired: true,
        expected,
        id: item.id,
        instruction: '',
        isEntry: item.id === entry,
        nodeKey: item.id,
        parentNodeId: undefined,
        requiredCheckItemIds: items,
        resourceSnapshot: undefined,
        subFlowId: undefined,
        title: item.title,
      };
    }),
    runs: [],
    title: board.artboard.content.groups.find((g) => g.id === board.journeyGroupId)?.title ?? '',
    version: 1,
  };

  return {
    boardOf: (nodeKey) => (ids.has(nodeKey) ? nodeKey : undefined),
    nodeOf: (boardId) => (ids.has(boardId) ? boardId : undefined),
    run: undefined,
    version,
  };
};

export const nodeAttempts = (view: JourneyView | undefined, boardId: string) => {
  const nodeKey = view?.nodeOf(boardId);
  if (!view?.run || !nodeKey) return [];
  const node = view.version.nodes.find((n) => n.nodeKey === nodeKey);
  return view.run.attempts.filter((attempt) => attempt.nodeId === node?.id);
};

export const nodeState = (view: JourneyView | undefined, boardId: string): FlowNodeState => {
  const nodeKey = view?.nodeOf(boardId);
  if (!view || !nodeKey) return undefined;
  return getFlowNodeState(
    nodeKey,
    view.version.entryNodeKey,
    view.version.edges,
    nodeAttempts(view, boardId),
  );
};

export const nodeReview = (view: JourneyView | undefined, boardId: string) =>
  nodeAttempts(view, boardId)[0]?.review ?? undefined;

export const boardPreview = (
  view: JourneyView | undefined,
  boardId: string,
  showReal: boolean,
): { kind: 'reference' | 'unavailable' } | { kind: 'screenshot'; url: string } => {
  if (!showReal) return { kind: 'reference' };
  const url = nodeAttempts(view, boardId)
    .flatMap((attempt) => attempt.evidence)
    .find((evidence) => evidence.type === 'screenshot' && evidence.fileUrl)?.fileUrl;
  return url ? { kind: 'screenshot', url } : { kind: 'unavailable' };
};
