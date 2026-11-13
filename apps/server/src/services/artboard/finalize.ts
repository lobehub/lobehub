import {
  type AcceptanceFlowDefinition,
  type AcceptanceFlowEdgeInput,
  type ArtboardContent,
  type ArtboardEdgeView,
  artboardJourneyOf,
} from '@lobechat/types';

export interface JourneyFlow {
  boardNodeIds: Record<string, string>;
  definition: AcceptanceFlowDefinition;
  edgeFlowIds: Record<string, string>;
}

const CONDITION_SEPARATOR = ' · ';

export const buildJourneyFlow = (content: ArtboardContent, newId: () => string): JourneyFlow => {
  const { boards = [], edges = [], group } = artboardJourneyOf(content);
  if (!group) throw new Error('The board has no single journey group');

  const screens = boards.filter((board) => board.type !== 'decision');
  const boardNodeIds = Object.fromEntries(
    screens.map((board) => [board.id, board.flowNodeId ?? newId()]),
  );
  const targets = new Set(edges.map((edge) => edge.to));
  const entry = screens.find((board) => !targets.has(board.id));
  if (!entry) throw new Error('The journey has no entry board');

  const titles = Object.fromEntries(boards.map((board) => [board.id, board.title]));
  const edgeFlowIds: Record<string, string> = {};
  const flowEdges: AcceptanceFlowEdgeInput[] = [];

  const emit = (first: ArtboardEdgeView, last: ArtboardEdgeView, conditions: string[]) => {
    const carrier = edgeFlowIds[last.id] ? undefined : last;
    const id = carrier?.flowEdgeId ?? newId();
    if (carrier) edgeFlowIds[carrier.id] = id;
    const condition = conditions.filter(Boolean).join(CONDITION_SEPARATOR);
    flowEdges.push({
      ...(condition ? { condition } : {}),
      id,
      required: true,
      sourceNodeId: boardNodeIds[first.from],
      targetNodeId: boardNodeIds[last.to],
      trigger: first.label || titles[first.to] || titles[last.to] || '',
    });
  };

  const walk = (
    first: ArtboardEdgeView,
    last: ArtboardEdgeView,
    conditions: string[],
    seen: Set<string>,
  ) => {
    if (boardNodeIds[last.to]) return emit(first, last, conditions);
    if (seen.has(last.to)) return;
    const through = new Set(seen).add(last.to);
    for (const out of edges)
      if (out.from === last.to)
        walk(first, out, [...conditions, out.condition || out.label], through);
  };

  for (const edge of edges)
    if (boardNodeIds[edge.from]) walk(edge, edge, [edge.condition ?? ''], new Set());

  return {
    boardNodeIds,
    definition: {
      edges: flowEdges,
      entryNodeId: boardNodeIds[entry.id],
      nodes: screens.map((board) => ({
        check: {
          definition: { expected: board.expected ?? '' },
          id: newId(),
          title: board.title,
        },
        id: boardNodeIds[board.id],
      })),
      title: group.title,
    },
    edgeFlowIds,
  };
};
