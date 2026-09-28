import type { GoalGraphNode } from '@lobechat/types';

import type { GoalGraphView } from '../goalGraphViewModel';

/**
 * The mainline the wrap-up report marked: the path that actually carried the
 * Goal to its result. It rides on the newest report version, so a rewritten
 * storyline redraws it and a Goal without a report keeps the plain map.
 */
export interface Mainline {
  edgeIds: ReadonlySet<string>;
  nodeIds: ReadonlySet<string>;
}

/** How a card or a line reads against the mainline; `undefined` leaves it as it was. */
export type MainlineEmphasis = 'mainline' | 'muted' | undefined;

export const resolveMainline = (
  graph: Pick<GoalGraphView, 'byId' | 'report'>,
): Mainline | undefined => {
  const mark = graph.report?.latest?.metadata.mainline;
  if (!mark) return undefined;
  // A node deleted since the report was written must not leave the whole map muted.
  const nodeIds = new Set(mark.nodeIds.filter((id) => graph.byId[id]));
  if (nodeIds.size === 0) return undefined;
  return { edgeIds: new Set(mark.edgeIds), nodeIds };
};

/**
 * A card is on the mainline when it was marked, or when it is an experiment
 * whose members were — collapsed, the experiment stands in for them. The root
 * question is the anchor every path starts from, so it is never muted.
 */
export const nodeEmphasis = (
  mainline: Mainline | undefined,
  node: Pick<GoalGraphNode, 'id' | 'kind'>,
  members: Iterable<string> = [],
): MainlineEmphasis => {
  if (!mainline) return undefined;
  if (mainline.nodeIds.has(node.id)) return 'mainline';
  for (const member of members) if (mainline.nodeIds.has(member)) return 'mainline';
  if (node.kind === 'problem') return undefined;
  return 'muted';
};

/**
 * Whether a card steps back on the map: still blocked before it started, or
 * off a marked mainline — unless the host is calling it out on purpose (a
 * chapter's detour on the report's local map), which must stay readable.
 */
export const isNodeDimmed = ({
  blocked,
  emphasis,
  highlighted,
}: {
  blocked: boolean;
  emphasis: MainlineEmphasis;
  highlighted: boolean;
}): boolean => blocked || (emphasis === 'muted' && !highlighted);

/**
 * A goal edge is on the mainline when the report marked it — a projected edge
 * keeps its goal edge id, so it follows its original. A bridge drawn through
 * hidden kinds has no id of its own: it is on the mainline when both of the
 * cards it joins are.
 */
export const edgeEmphasis = (
  mainline: Mainline | undefined,
  edge: { bridge?: boolean; id: string; sourceNodeId: string; targetNodeId: string },
  isMainlineCard: (id: string) => boolean,
): MainlineEmphasis => {
  if (!mainline) return undefined;
  const on = edge.bridge
    ? isMainlineCard(edge.sourceNodeId) && isMainlineCard(edge.targetNodeId)
    : mainline.edgeIds.has(edge.id);
  return on ? 'mainline' : 'muted';
};
