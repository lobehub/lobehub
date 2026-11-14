import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import type {
  GoalEdgeKind,
  GoalGraphSnapshot,
  GoalNodeKind,
  GoalNodeStatus,
  GoalReportDetourKind,
  GoalStatus,
} from '@lobechat/types';

/** One verified criterion of an Acceptance, as a visitor reads it. */
export interface SharedGoalCheck {
  /** `passed` when the criterion held; every other state reads as not (yet) passed. */
  passed: boolean;
  state: 'failed' | 'not_executed' | 'passed' | 'uncertain';
  /** The verifier's reasoning for the verdict, when it wrote one. */
  summary: string | null;
  /** The criterion text. */
  title: string;
}

export interface SharedGoalAcceptance {
  checks: SharedGoalCheck[];
  status: string;
}

/** What the server read for one Acceptance — the redaction's only input about it. */
export type SharedGoalAcceptanceInput = SharedGoalAcceptance;

export interface SharedGoalNode {
  acceptance?: SharedGoalAcceptance;
  /** Opaque, view-local ids of the nodes this one depends on. */
  dependsOn: string[];
  /** View-local id (`n1`, `n2`, …): the graph's real ids never leave the server. */
  id: string;
  kind: GoalNodeKind;
  status: GoalNodeStatus;
  title: string;
}

export interface SharedGoalEdge {
  from: string;
  id: string;
  kind: GoalEdgeKind;
  to: string;
}

export interface SharedGoalReport {
  chapters: {
    detours: {
      kind: GoalReportDetourKind;
      lesson: string;
      nodeIds: string[];
      reason: string;
      title: string;
    }[];
    findingIds: string[];
    narrative: string;
    nodeIds: string[];
    title: string;
  }[];
  deliverableWorkId?: string;
  headline: string;
  mainline?: { edgeIds: string[]; nodeIds: string[] };
  nextSteps: { nodeIds?: string[]; reason: string; title: string }[];
}

export interface SharedGoalView {
  /** The Goal-level acceptance (the node that closes the Goal), when it has been judged. */
  acceptance: SharedGoalAcceptance | null;
  edges: SharedGoalEdge[];
  goal: { requirement: string | null; status: GoalStatus; title: string };
  nodes: SharedGoalNode[];
  report: SharedGoalReport | null;
}

/**
 * The read-only view an anonymous visitor gets of a shared Goal.
 *
 * Built by copying an explicit allow-list of fields out of the graph rather
 * than deleting the sensitive ones, so a field added to the snapshot later is
 * private until someone decides otherwise. Everything that identifies an owner,
 * a run or money — user ids, cost and budget, config, events, decisions,
 * assignees, heartbeats, task / topic / operation ids — is never read. Node and
 * edge ids are replaced with view-local ones because the real ids are internal;
 * the report's references to nodes are remapped the same way and dropped when
 * they point outside the shared graph.
 */
export const buildSharedGoalView = (
  graph: Pick<GoalGraphSnapshot, 'edges' | 'goal' | 'nodes' | 'report'>,
  /** Acceptance read per real acceptance id; `nodeAcceptanceIds` maps node → acceptance. */
  acceptances: Record<string, SharedGoalAcceptanceInput>,
  nodeAcceptanceIds: Record<string, string>,
): SharedGoalView => {
  const ordered = [...graph.nodes].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const nodeIds = new Map(ordered.map((node, index) => [node.id, `n${index + 1}`]));
  const mapNodes = (ids: string[] | undefined) =>
    (ids ?? []).flatMap((id) => {
      const mapped = nodeIds.get(id);
      return mapped ? [mapped] : [];
    });

  const edges: SharedGoalEdge[] = [];
  const edgeIds = new Map<string, string>();
  for (const edge of graph.edges) {
    const from = nodeIds.get(edge.sourceNodeId);
    const to = nodeIds.get(edge.targetNodeId);
    if (!from || !to) continue;
    const id = `e${edgeIds.size + 1}`;
    edgeIds.set(edge.id, id);
    edges.push({ from, id, kind: edge.kind, to });
  }

  const acceptanceOf = (nodeId: string) => {
    const acceptanceId = nodeAcceptanceIds[nodeId];
    const found = acceptanceId ? acceptances[acceptanceId] : undefined;
    return found
      ? {
          checks: found.checks.map((check) => ({
            passed: check.passed,
            state: check.state,
            summary: check.summary,
            title: check.title,
          })),
          status: found.status,
        }
      : undefined;
  };

  const nodes: SharedGoalNode[] = ordered.map((node) => {
    const acceptance = acceptanceOf(node.id);
    return {
      ...(acceptance ? { acceptance } : {}),
      dependsOn: graph.edges
        .filter((edge) => edge.kind === 'depends_on' && edge.sourceNodeId === node.id)
        .flatMap((edge) => mapNodes([edge.targetNodeId])),
      id: nodeIds.get(node.id)!,
      kind: node.kind,
      status: node.status,
      title: node.title,
    };
  });

  const goalAcceptanceNode = graph.nodes.find(
    (node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE,
  );

  const latest = graph.report?.latest?.metadata;
  const report: SharedGoalReport | null = latest
    ? {
        chapters: latest.chapters.map((chapter) => ({
          detours: chapter.detours.map((detour) => ({
            kind: detour.kind,
            lesson: detour.lesson,
            nodeIds: mapNodes(detour.nodeIds),
            reason: detour.reason,
            title: detour.title,
          })),
          findingIds: mapNodes(chapter.findingIds),
          narrative: chapter.narrative,
          nodeIds: mapNodes(chapter.nodeIds),
          title: chapter.title,
        })),
        ...(latest.deliverableWorkId ? { deliverableWorkId: latest.deliverableWorkId } : {}),
        headline: latest.headline,
        ...(latest.mainline
          ? {
              mainline: {
                edgeIds: (latest.mainline.edgeIds ?? []).flatMap((id) => {
                  const mapped = edgeIds.get(id);
                  return mapped ? [mapped] : [];
                }),
                nodeIds: mapNodes(latest.mainline.nodeIds),
              },
            }
          : {}),
        nextSteps: latest.nextSteps.map((step) => ({
          ...(step.nodeIds ? { nodeIds: mapNodes(step.nodeIds) } : {}),
          reason: step.reason,
          title: step.title,
        })),
      }
    : null;

  return {
    acceptance: goalAcceptanceNode ? (acceptanceOf(goalAcceptanceNode.id) ?? null) : null,
    edges,
    goal: {
      requirement: graph.goal.requirement,
      status: graph.goal.status,
      title: graph.goal.title,
    },
    nodes,
    report,
  };
};
