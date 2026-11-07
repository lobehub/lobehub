import {
  type AcceptanceFlowDefinition,
  type ArtboardContent,
  artboardJourneyOf,
} from '@lobechat/types';

export { type ArtboardFinalizeIssue, checkFinalizeReadiness } from '@lobechat/types';

export interface JourneyFlow {
  arrowEdgeIds: Record<string, string>;
  definition: AcceptanceFlowDefinition;
  frameNodeIds: Record<string, string>;
}

export const buildJourneyFlow = (content: ArtboardContent, newId: () => string): JourneyFlow => {
  const { arrows = [], frames = [], group } = artboardJourneyOf(content);
  if (!group) throw new Error('The board has no single journey group');

  const frameNodeIds = Object.fromEntries(frames.map((f) => [f.id, f.flowNodeId ?? newId()]));
  const arrowEdgeIds = Object.fromEntries(arrows.map((a) => [a.id, a.flowEdgeId ?? newId()]));
  const targets = new Set(arrows.map((a) => a.to));
  const entry = frames.find((f) => !targets.has(f.id));
  if (!entry) throw new Error('The journey has no entry frame');

  return {
    arrowEdgeIds,
    definition: {
      edges: arrows.map((arrow) => ({
        id: arrowEdgeIds[arrow.id],
        required: true,
        sourceNodeId: frameNodeIds[arrow.from],
        targetNodeId: frameNodeIds[arrow.to],
        trigger: arrow.label,
      })),
      entryNodeId: frameNodeIds[entry.id],
      nodes: frames.map((frame) => ({
        check: {
          definition: { expected: frame.check?.expected ?? '' },
          id: newId(),
          title: frame.title,
        },
        id: frameNodeIds[frame.id],
      })),
      title: group.title,
    },
    frameNodeIds,
  };
};
