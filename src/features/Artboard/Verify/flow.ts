import type { FlowVersion } from '@/features/Acceptance/Viewer/Flow/flowNavigation';
import { getFlowNodeState } from '@/features/Acceptance/Viewer/Flow/flowNodeState';

import type { BoardModel } from '../model';

export type FlowRun = FlowVersion['runs'][number];
export type FlowNodeState = ReturnType<typeof getFlowNodeState>;

export interface JourneyView {
  edgeOf: (arrowId: string) => string | undefined;
  frameOf: (nodeKey: string) => string | undefined;
  nodeOf: (frameId: string) => string | undefined;
  run: FlowRun | undefined;
  version: FlowVersion;
}

export const draftJourneyView = (board: BoardModel): JourneyView | undefined => {
  const entry = board.journeyEntryId;
  if (!entry || !board.journeyFrames.length) return;

  const edges = board.journeyArrows.map((arrow) => ({
    condition: undefined,
    edgeKey: arrow.id,
    id: arrow.id,
    required: true,
    sourceNodeId: arrow.from,
    sourceNodeKey: arrow.from,
    targetNodeId: arrow.to,
    targetNodeKey: arrow.to,
    trigger: arrow.label,
  }));
  const ids = new Set(board.journeyFrames.map((f) => f.id));

  const version: FlowVersion = {
    edges,
    entryNodeKey: entry,
    flowId: board.artboard.id,
    id: board.artboard.id,
    nodes: board.journeyFrames.map((frame) => {
      const items = [
        ...(frame.id === entry ? [`${frame.id}:entry`] : []),
        ...edges.filter((e) => e.targetNodeKey === frame.id).map((e) => `${frame.id}:${e.id}`),
      ];
      const expected = frame.check?.expected ?? '';
      return {
        checkItemIds: items,
        criterionId: undefined,
        definition: { expected },
        entryRequired: true,
        expected,
        id: frame.id,
        instruction: '',
        isEntry: frame.id === entry,
        nodeKey: frame.id,
        parentNodeId: undefined,
        requiredCheckItemIds: items,
        resourceSnapshot: undefined,
        subFlowId: undefined,
        title: frame.title,
      };
    }),
    runs: [],
    title: board.groups.find((g) => g.id === board.journeyGroupId)?.title ?? '',
    version: 1,
  };

  const arrowIds = new Set(edges.map((e) => e.id));
  return {
    edgeOf: (arrowId) => (arrowIds.has(arrowId) ? arrowId : undefined),
    frameOf: (nodeKey) => (ids.has(nodeKey) ? nodeKey : undefined),
    nodeOf: (frameId) => (ids.has(frameId) ? frameId : undefined),
    run: undefined,
    version,
  };
};

export const nodeAttempts = (view: JourneyView | undefined, frameId: string) => {
  const nodeKey = view?.nodeOf(frameId);
  if (!view?.run || !nodeKey) return [];
  const node = view.version.nodes.find((n) => n.nodeKey === nodeKey);
  return view.run.attempts.filter((attempt) => attempt.nodeId === node?.id);
};

export const nodeState = (view: JourneyView | undefined, frameId: string): FlowNodeState => {
  const nodeKey = view?.nodeOf(frameId);
  if (!view || !nodeKey) return undefined;
  return getFlowNodeState(
    nodeKey,
    view.version.entryNodeKey,
    view.version.edges,
    nodeAttempts(view, frameId),
  );
};

export const nodeReview = (view: JourneyView | undefined, frameId: string) =>
  nodeAttempts(view, frameId)[0]?.review ?? undefined;
