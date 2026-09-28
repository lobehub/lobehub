import { GOAL_ACCEPTANCE_TASK_TITLE, GOAL_REPORT_TASK_TITLE } from '@lobechat/const/goal';
import type {
  GoalEdgeKind,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalReportMetadata,
  GoalReportTrigger,
} from '@lobechat/types';

/**
 * The wrap-up branch of the Goal coordinator: once the Goal-level acceptance
 * has ended, a wrap-up agent turns the graph into a storyline. Everything here
 * is a pure function of the graph so the dispatch rule, the skeleton handed to
 * the agent and the checks on what it submits can be tested without IO.
 */

export const isGoalReportNode = (node: Pick<GoalGraphNode, 'kind' | 'title'>) =>
  node.kind === 'task' && node.title === GOAL_REPORT_TASK_TITLE;

/**
 * The graph as the coordinator should see it: without the wrap-up node, its
 * edges and its Work links. The wrap-up never takes part in deciding the Goal's
 * status — a failed or timed-out report must not open a gate or keep a Goal
 * from finishing — so every decision path reads this view.
 */
export const withoutGoalReport = <T extends GoalGraphSnapshot>(graph: T): T => {
  const hidden = new Set(graph.nodes.filter(isGoalReportNode).map((node) => node.id));
  if (hidden.size === 0) return graph;
  return {
    ...graph,
    edges: graph.edges.filter(
      (edge) => !hidden.has(edge.sourceNodeId) && !hidden.has(edge.targetNodeId),
    ),
    nodes: graph.nodes.filter((node) => !hidden.has(node.id)),
    workVersions: graph.workVersions.filter((link) => !hidden.has(link.nodeId)),
  };
};

const acceptanceNodeOf = (graph: GoalGraphSnapshot) =>
  graph.nodes.find((node) => node.kind === 'task' && node.title === GOAL_ACCEPTANCE_TASK_TITLE);

const IN_PROGRESS_STATUSES = new Set(['proposed', 'active', 'waiting']);

export interface AcceptanceResult {
  /** Stable identity of this acceptance result: one wrap-up per key. */
  key: string;
  trigger: GoalReportTrigger;
}

/**
 * The acceptance result the Goal currently rests on, or undefined while the
 * Goal-level acceptance has not ended.
 *
 * - accepted            — the acceptance node resolved and no other work is open.
 * - acceptance_failed   — the acceptance was rejected with its attempts spent: the
 *                         gate it opened (pending, or answered `fail`/`retire`).
 * - goal_failed/canceled — the Goal itself ended without such a result.
 *
 * Each key names the event that produced it (resolution instant, gate id, goal
 * status event), so a Goal that is sent back for changes and accepted again
 * yields a new key — and a new report version — while re-reading the same
 * result never dispatches twice.
 */
export const resolveAcceptanceResult = (graph: GoalGraphSnapshot): AcceptanceResult | undefined => {
  const view = withoutGoalReport(graph);
  const acceptance = acceptanceNodeOf(view);

  if (acceptance) {
    const otherWorkOpen = view.nodes.some(
      (node) =>
        node.kind === 'task' && node.id !== acceptance.id && IN_PROGRESS_STATUSES.has(node.status),
    );
    if (acceptance.status === 'resolved' && !otherWorkOpen) {
      const at = acceptance.resolvedAt ?? acceptance.updatedAt;
      return { key: `accepted:${acceptance.id}:${new Date(at).getTime()}`, trigger: 'accepted' };
    }

    const gateNodeIds = new Set(
      view.edges
        .filter((edge) => edge.kind === 'leads_to' && edge.sourceNodeId === acceptance.id)
        .map((edge) => edge.targetNodeId),
    );
    const gate = view.decisions
      .filter((decision) => gateNodeIds.has(decision.nodeId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (
      gate &&
      (gate.status === 'pending' ||
        (gate.status === 'resolved' &&
          (gate.resolvedOptionId === 'fail' || gate.resolvedOptionId === 'retire')))
    ) {
      return { key: `acceptance_failed:${gate.id}`, trigger: 'acceptance_failed' };
    }
  }

  if (graph.goal.status === 'failed' || graph.goal.status === 'canceled') {
    // A person may end a Goal mid-acceptance; the acceptance will not finish
    // after that, so the Goal's own end is the result the report is written for.
    const ended = graph.events.find(
      (event) =>
        event.entityType === 'goal' &&
        event.entityId === graph.goal.id &&
        event.eventType === 'rejected',
    );
    // Keyed by the status event, never by `goal.updatedAt`: recording the
    // dispatch receipt on the goal row moves that, which would read as a new
    // result on the next tick and dispatch again.
    return {
      key: `goal_${graph.goal.status}:${ended?.id ?? 'ended'}`,
      trigger: graph.goal.status === 'failed' ? 'goal_failed' : 'goal_canceled',
    };
  }

  return undefined;
};

export type GoalReportDecision =
  { dispatch: false; reason: string } | ({ dispatch: true } & AcceptanceResult);

/**
 * Whether the coordinator should dispatch a wrap-up run now. Never before the
 * Goal-level acceptance has ended, and once per acceptance result.
 */
export const decideGoalReport = (graph: GoalGraphSnapshot): GoalReportDecision => {
  const result = resolveAcceptanceResult(graph);
  if (!result) return { dispatch: false, reason: 'Goal-level acceptance has not ended' };
  if (graph.goal.config?.report?.acceptanceKey === result.key)
    return { dispatch: false, reason: 'A wrap-up was already dispatched for this result' };
  return { dispatch: true, ...result };
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

const PATH_EDGE_KINDS = new Set<GoalEdgeKind>(['depends_on', 'derived_from']);
const SUPERSEDING_EDGE_KINDS = new Set<GoalEdgeKind>(['revises', 'contradicts']);
const DEAD_STATUSES = new Set(['rejected', 'retired']);
const STORY_KINDS = new Set(['task', 'experiment', 'finding']);

export interface GoalReportSkeletonNode {
  findingIds: string[];
  id: string;
  kind: GoalGraphNode['kind'];
  status: GoalGraphNode['status'];
  title: string;
  workVersionIds: string[];
}

export interface GoalReportSkeletonDetour {
  /** Node on the main path this detour branched from, when one could be found. */
  forkNodeId?: string;
  id: string;
  kind: GoalGraphNode['kind'];
  /** Why the skeleton flags it: the node's own status, or the node that superseded it. */
  signal: string;
  status: GoalGraphNode['status'];
  title: string;
}

export interface GoalReportSkeleton {
  acceptance: {
    finding?: string;
    gate?: { question: string; resolution?: string | null; status: string };
    nodeId?: string;
    status?: string;
  };
  deliverable?: { title: string | null; type: string; workId: string; workVersionId: string };
  detours: GoalReportSkeletonDetour[];
  graphCursor?: string;
  mainPath: GoalReportSkeletonNode[];
}

/** Nodes superseded by another through `revises` / `contradicts`, mapped to their successor. */
const supersededBy = (graph: GoalGraphSnapshot) => {
  const map = new Map<string, string>();
  for (const edge of graph.edges) {
    if (SUPERSEDING_EDGE_KINDS.has(edge.kind)) map.set(edge.targetNodeId, edge.sourceNodeId);
  }
  return map;
};

/**
 * The deterministic part of the story, handed to the wrap-up agent as a
 * starting point: the candidate main path traced back from the final
 * deliverable, and the candidate detours hung under the fork they left from.
 * The agent decides chapters, names, narrative and which detours matter.
 */
export const buildGoalReportSkeleton = (source: GoalGraphSnapshot): GoalReportSkeleton => {
  const graph = withoutGoalReport(source);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const acceptance = acceptanceNodeOf(graph);

  const produced = graph.workVersions.filter(
    (link) => link.relation === 'produced' && link.work && link.work.type !== 'task',
  );
  const newest = <T extends { createdAt: Date }>(items: T[]) =>
    [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const deliverableLink =
    newest(produced.filter((link) => link.nodeId === acceptance?.id)) ?? newest(produced);

  // Walk back from the node that closed the Goal (or produced its deliverable).
  const starts = [acceptance?.id, deliverableLink?.nodeId].filter(Boolean) as string[];
  if (starts.length === 0) {
    starts.push(
      ...graph.nodes
        .filter((node) => node.kind === 'task' && node.status === 'resolved')
        .map((node) => node.id),
    );
  }
  const visited = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.edges) {
      if (edge.sourceNodeId === id && (PATH_EDGE_KINDS.has(edge.kind) || edge.kind === 'produces'))
        queue.push(edge.targetNodeId);
      if (edge.targetNodeId === id && edge.kind === 'produces') queue.push(edge.sourceNodeId);
    }
  }

  const superseded = supersededBy(graph);
  const onMainPath = (node: GoalGraphNode) =>
    visited.has(node.id) &&
    node.status === 'resolved' &&
    STORY_KINDS.has(node.kind) &&
    !superseded.has(node.id);

  const byCreation = (a: GoalGraphNode, b: GoalGraphNode) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  const mainNodes = graph.nodes.filter(onMainPath).sort(byCreation);
  const mainIds = new Set(mainNodes.map((node) => node.id));
  const findingsOf = (id: string) =>
    graph.edges
      .filter((edge) => edge.sourceNodeId === id && edge.kind === 'produces')
      .map((edge) => edge.targetNodeId)
      .filter((target) => byId.get(target)?.kind === 'finding');

  const mainPath = mainNodes
    .filter((node) => node.kind !== 'finding')
    .map((node) => ({
      findingIds: findingsOf(node.id),
      id: node.id,
      kind: node.kind,
      status: node.status,
      title: node.title,
      workVersionIds: graph.workVersions
        .filter((link) => link.nodeId === node.id)
        .map((link) => link.workVersionId),
    }));

  const forkOf = (node: GoalGraphNode): string | undefined => {
    const successor = superseded.get(node.id);
    if (successor && mainIds.has(successor)) return successor;
    const upstream = graph.edges.find(
      (edge) =>
        edge.sourceNodeId === node.id &&
        PATH_EDGE_KINDS.has(edge.kind) &&
        mainIds.has(edge.targetNodeId),
    );
    if (upstream) return upstream.targetNodeId;
    const container = graph.edges.find(
      (edge) => edge.kind === 'contains' && edge.targetNodeId === node.id,
    );
    return container?.sourceNodeId;
  };

  const detours = graph.nodes
    .filter(
      (node) =>
        STORY_KINDS.has(node.kind) &&
        !mainIds.has(node.id) &&
        (DEAD_STATUSES.has(node.status) || superseded.has(node.id)),
    )
    .sort(byCreation)
    .map((node) => {
      const successor = superseded.get(node.id);
      return {
        forkNodeId: forkOf(node),
        id: node.id,
        kind: node.kind,
        signal: successor
          ? `superseded by ${successor} (${graph.edges.find((edge) => edge.sourceNodeId === successor && edge.targetNodeId === node.id)?.kind})`
          : node.status,
        status: node.status,
        title: node.title,
      };
    });

  const gateNodeIds = new Set(
    graph.edges
      .filter((edge) => edge.kind === 'leads_to' && edge.sourceNodeId === acceptance?.id)
      .map((edge) => edge.targetNodeId),
  );
  const gate = graph.decisions
    .filter((decision) => gateNodeIds.has(decision.nodeId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const acceptanceFinding = acceptance
    ? findingsOf(acceptance.id)
        .map((id) => byId.get(id))
        .find(Boolean)
    : undefined;

  const newestEvent = [...source.events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];

  return {
    acceptance: {
      finding: acceptanceFinding
        ? [acceptanceFinding.title, acceptanceFinding.description].filter(Boolean).join(' — ')
        : undefined,
      gate: gate
        ? { question: gate.question, resolution: gate.resolution, status: gate.status }
        : undefined,
      nodeId: acceptance?.id,
      status: acceptance?.status,
    },
    deliverable: deliverableLink?.work
      ? {
          title: deliverableLink.work.title,
          type: deliverableLink.work.type,
          workId: deliverableLink.work.workId,
          workVersionId: deliverableLink.workVersionId,
        }
      : undefined,
    detours,
    graphCursor: newestEvent?.id,
    mainPath,
  };
};

const TRIGGER_LABEL: Record<GoalReportTrigger, string> = {
  acceptance_failed: 'Goal-level acceptance ended without passing (attempts spent or rejected)',
  accepted: 'Goal-level acceptance passed',
  goal_canceled: 'The Goal was canceled',
  goal_failed: 'The Goal was marked failed',
};

/** The wrap-up agent's instruction: the skeleton plus what it must produce. */
export const buildGoalReportInstruction = (
  graph: GoalGraphSnapshot,
  trigger: GoalReportTrigger,
  submitToolName: string,
): string => {
  const skeleton = buildGoalReportSkeleton(graph);
  const line = (node: { id: string; kind: string; status: string; title: string }) =>
    `${node.id} [${node.kind}, ${node.status}] ${node.title}`;

  return [
    `Write the wrap-up report of the Goal "${graph.goal.title}" (goalId: ${graph.goal.id}).`,
    `Why now: ${TRIGGER_LABEL[trigger]}. Goal status: ${graph.goal.status}.`,
    graph.goal.requirement ? `Goal requirement:\n${graph.goal.requirement}` : undefined,
    [
      'Acceptance result summary:',
      `- acceptance node: ${skeleton.acceptance.nodeId ?? 'none'} (${skeleton.acceptance.status ?? 'not created'})`,
      skeleton.acceptance.finding
        ? `- acceptance conclusion: ${skeleton.acceptance.finding}`
        : undefined,
      skeleton.acceptance.gate
        ? `- acceptance gate (${skeleton.acceptance.gate.status}): ${skeleton.acceptance.gate.question}${skeleton.acceptance.gate.resolution ? ` → ${skeleton.acceptance.gate.resolution}` : ''}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    skeleton.deliverable
      ? `Final deliverable: Work ${skeleton.deliverable.workId} (${skeleton.deliverable.type}) "${skeleton.deliverable.title ?? ''}", version ${skeleton.deliverable.workVersionId}`
      : 'Final deliverable: none linked to the graph.',
    [
      'Candidate main path (traced back from the final deliverable along produces / depends_on / derived_from, oldest first):',
      ...skeleton.mainPath.map(
        (node) =>
          `- ${line(node)}${node.findingIds.length ? ` · findings: ${node.findingIds.join(', ')}` : ''}${node.workVersionIds.length ? ` · work versions: ${node.workVersionIds.join(', ')}` : ''}`,
      ),
    ].join('\n'),
    [
      'Candidate detours (rejected / retired / superseded), under the fork they left from:',
      ...(skeleton.detours.length
        ? skeleton.detours.map(
            (node) => `- ${line(node)} · ${node.signal} · fork: ${node.forkNodeId ?? 'unknown'}`,
          )
        : ['- none']),
    ].join('\n'),
    `Graph cursor: ${skeleton.graphCursor ?? 'none'}`,
    [
      'What to do:',
      '1. Inspect the Goal, its findings and deliverables as needed. The skeleton is a starting point, not the answer.',
      '2. Split the main path into a few chapters. Give each a title and a narrative of what was tried, what was learned and what it produced; reference its nodeIds (resolved main-path nodes only), findingIds and workVersionIds.',
      '3. Decide which detours are worth telling. For each one attach it to the chapter it forked from, with kind (dead_end | superseded | retry), the reason it was abandoned and the lesson it taught. Leave out detours that teach nothing.',
      '4. Write nextSteps: what remains or should come next, each with a reason.',
      '5. Write a one-sentence headline, and set deliverableWorkId when there is a final deliverable.',
      '6. Do NOT restate acceptance verdicts or user decisions as data; the page reads those from their own records. Narrate around them.',
      `7. Call ${submitToolName} once with goalId, the metadata (headline, deliverableWorkId, chapters, nextSteps, graphCursor) and content: the full written report in markdown, built from that same metadata. If it rejects a reference, fix it and call again.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
};

// ---------------------------------------------------------------------------
// Validation of a submitted report
// ---------------------------------------------------------------------------

/**
 * Every reference in a submitted report must belong to this Goal, main-path
 * nodes must be resolved, and a detour must really be one: rejected, retired,
 * or superseded through `revises` / `contradicts`. Returns every problem found
 * so the agent can fix them in one pass.
 */
export const validateGoalReport = (
  source: GoalGraphSnapshot,
  metadata: GoalReportMetadata,
  options: { eventIds?: Set<string> } = {},
): string[] => {
  const graph = withoutGoalReport(source);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const workVersionIds = new Set(graph.workVersions.map((link) => link.workVersionId));
  const workIds = new Set(
    graph.workVersions.flatMap((link) => (link.work ? [link.work.workId] : [])),
  );
  const superseded = supersededBy(graph);
  const errors: string[] = [];

  metadata.chapters.forEach((chapter, index) => {
    const at = `chapters[${index}]`;
    for (const id of chapter.nodeIds) {
      const node = byId.get(id);
      if (!node) errors.push(`${at}.nodeIds: ${id} is not a node of this Goal`);
      else if (node.status !== 'resolved')
        errors.push(`${at}.nodeIds: ${id} is ${node.status}; main-path nodes must be resolved`);
    }
    for (const id of chapter.findingIds) {
      const node = byId.get(id);
      if (!node || node.kind !== 'finding')
        errors.push(`${at}.findingIds: ${id} is not a finding of this Goal`);
    }
    for (const id of chapter.workVersionIds) {
      if (!workVersionIds.has(id))
        errors.push(`${at}.workVersionIds: ${id} is not a Work version linked to this Goal`);
    }
    chapter.detours.forEach((detour, detourIndex) => {
      for (const id of detour.nodeIds) {
        const node = byId.get(id);
        if (!node) {
          errors.push(`${at}.detours[${detourIndex}].nodeIds: ${id} is not a node of this Goal`);
        } else if (!DEAD_STATUSES.has(node.status) && !superseded.has(id)) {
          errors.push(
            `${at}.detours[${detourIndex}].nodeIds: ${id} is ${node.status} and not superseded by revises/contradicts`,
          );
        }
      }
    });
  });

  metadata.nextSteps.forEach((step, index) => {
    for (const id of step.nodeIds ?? []) {
      if (!byId.has(id))
        errors.push(`nextSteps[${index}].nodeIds: ${id} is not a node of this Goal`);
    }
  });

  if (metadata.deliverableWorkId && !workIds.has(metadata.deliverableWorkId))
    errors.push(
      `deliverableWorkId: ${metadata.deliverableWorkId} is not a Work linked to this Goal`,
    );

  if (options.eventIds && !options.eventIds.has(metadata.graphCursor))
    errors.push(`graphCursor: ${metadata.graphCursor} is not an event of this Goal`);

  return errors;
};
