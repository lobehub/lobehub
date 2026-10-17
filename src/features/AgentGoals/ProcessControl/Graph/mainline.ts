import type { GoalGraphNode } from '@lobechat/types';
import { experimentMembers } from '@lobechat/utils/goalGraph';
import { cssVar } from '@lobehub/ui';

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
  graph: Pick<GoalGraphView, 'byId' | 'edges' | 'nodes' | 'report'>,
): Mainline | undefined => {
  const mark = graph.report?.latest?.metadata.mainline;
  if (!mark) return undefined;
  // A node deleted since the report was written must not leave the whole map muted.
  const nodeIds = new Set(mark.nodeIds.filter((id) => graph.byId[id]));
  if (nodeIds.size === 0) return undefined;
  const mainline: Mainline = { edgeIds: new Set(mark.edgeIds), nodeIds };
  // A mark that reaches every card rings the whole map and says nothing. The
  // wrap-up model does exactly that when it cannot tell the path apart, so the
  // host draws the plain map instead of a mainline nothing stands against.
  return mainlineContrasts(mainline, graph) ? mainline : undefined;
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
 * Whether any card the map draws stands off the mark. A collapsed experiment
 * stands in for its members, so it counts as on the mainline when they are —
 * the rule {@link nodeEmphasis} applies when the card is painted.
 */
const mainlineContrasts = (
  mainline: Mainline,
  graph: Pick<GoalGraphView, 'edges' | 'nodes'>,
): boolean => {
  const snapshot = { edges: graph.edges, nodes: graph.nodes.map((view) => view.node) };
  for (const view of graph.nodes) {
    const members =
      view.node.kind === 'experiment' ? experimentMembers(snapshot, view.node.id, false) : [];
    if (nodeEmphasis(mainline, view.node, members) === 'muted') return true;
  }
  return false;
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

/** How a line is drawn: {@link MainlineEmphasis}, or part of a called-out detour. */
export type EdgeTone = MainlineEmphasis | 'detour';

/**
 * The mainline keeps its own line. Any other line touching a card the host
 * calls out — a chapter's detour — is part of that detour, and reads as one
 * instead of stepping back with the rest of the off-mainline map.
 */
export const edgeTone = (
  mainline: Mainline | undefined,
  edge: Parameters<typeof edgeEmphasis>[1],
  isMainlineCard: (id: string) => boolean,
  highlightedIds: ReadonlySet<string> = new Set(),
): EdgeTone => {
  const emphasis = edgeEmphasis(mainline, edge, isMainlineCard);
  if (emphasis === 'mainline') return emphasis;
  if (highlightedIds.has(edge.sourceNodeId) || highlightedIds.has(edge.targetNodeId))
    return 'detour';
  return emphasis;
};

/**
 * How far an off-mainline line steps back.
 *
 * On the light canvas the border token at a third opacity reads as intended —
 * clearly behind the mainline, still present. On the dark canvas that same
 * combination sinks into the background, so the line is lifted just enough to
 * stay legible. The mainline keeps its own bold primary line either way, so the
 * hierarchy is never flattened.
 */
export const MUTED_EDGE_OPACITY = 0.3;
export const MUTED_EDGE_OPACITY_DARK = 0.5;

/**
 * The arrowhead that ends a line, in the same tone as the line itself. An
 * off-mainline marker uses the border token on the light canvas; on the dark one
 * that token is nearly invisible, so it borrows the lighter text token.
 */
export const edgeMarkerColor = (tone: EdgeTone, isDarkMode: boolean): string => {
  if (tone === 'mainline') return cssVar.colorPrimary;
  if (tone === 'detour') return cssVar.colorWarning;
  return isDarkMode ? cssVar.colorTextQuaternary : cssVar.colorBorder;
};
