import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
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

/**
 * The wrap-up node is the one the dispatch recorded on the Goal. It is never
 * matched by title: any task a planner or a person happens to call "Write the
 * Goal report" would otherwise be hidden from the coordinator and reused as
 * the wrap-up.
 */
export const goalReportNodeId = (graph: Pick<GoalGraphSnapshot, 'goal'>) =>
  graph.goal.config?.report?.nodeId;

export const isGoalReportNode = (
  graph: Pick<GoalGraphSnapshot, 'goal'>,
  node: Pick<GoalGraphNode, 'id'>,
) => node.id === goalReportNodeId(graph);

/**
 * The graph as the coordinator should see it: without the wrap-up node, its
 * edges and its Work links. The wrap-up never takes part in deciding the Goal's
 * status — a failed or timed-out report must not open a gate or keep a Goal
 * from finishing — so every decision path reads this view.
 */
export const withoutGoalReport = <T extends GoalGraphSnapshot>(graph: T): T => {
  const reportNodeId = goalReportNodeId(graph);
  if (!reportNodeId) return graph;
  const hidden = new Set([reportNodeId]);
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
  /** Candidate mainline mark: the resolved root question, main-path nodes and their findings, and the edges among them. */
  mainline: {
    edges: { id: string; kind: GoalEdgeKind; source: string; target: string }[];
    nodeIds: string[];
  };
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

  const mainlineIds = new Set([
    ...graph.nodes
      .filter((node) => node.kind === 'problem' && node.status === 'resolved')
      .map((node) => node.id),
    ...mainNodes.map((node) => node.id),
  ]);
  const mainline = {
    edges: graph.edges
      .filter((edge) => mainlineIds.has(edge.sourceNodeId) && mainlineIds.has(edge.targetNodeId))
      .map((edge) => ({
        id: edge.id,
        kind: edge.kind,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
      })),
    nodeIds: graph.nodes.filter((node) => mainlineIds.has(node.id)).map((node) => node.id),
  };

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
    mainline,
  };
};

const TRIGGER_LABEL: Record<GoalReportTrigger, string> = {
  acceptance_failed: 'Goal-level acceptance ended without passing (attempts spent or rejected)',
  accepted: 'Goal-level acceptance passed',
  goal_canceled: 'The Goal was canceled',
  goal_failed: 'The Goal was marked failed',
};

/** The wrap-up agent's instruction: the skeleton plus what it must produce. */
/**
 * How the wrap-up agent submits. An ordinary agent gets the report tool; a
 * heterogeneous agent (Claude Code, Codex…) runs on a device where server tools
 * are not wired in, so it submits through the `lh` CLI instead — the same way
 * a heterogeneous main Agent submits its plan.
 */
export type GoalReportSubmission = { kind: 'cli' } | { kind: 'tool'; toolName: string };

export const buildGoalReportInstruction = (
  graph: GoalGraphSnapshot,
  trigger: GoalReportTrigger,
  submission: GoalReportSubmission,
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
      : 'Final deliverable: none linked to the graph — when reporting, omit deliverableWorkId entirely.',
    [
      'Candidate main path (traced back from the final deliverable along produces / depends_on / derived_from, oldest first):',
      ...skeleton.mainPath.map(
        (node) =>
          `- ${line(node)}${node.findingIds.length ? ` · findings: ${node.findingIds.join(', ')}` : ''}${node.workVersionIds.length ? ` · work versions: ${node.workVersionIds.join(', ')}` : ''}`,
      ),
    ].join('\n'),
    [
      skeleton.detours.length
        ? `Candidate detours (rejected / retired / superseded), under the fork they left from — at least ONE of these must be told as a detour:`
        : 'Candidate detours (rejected / retired / superseded), under the fork they left from:',
      ...(skeleton.detours.length
        ? skeleton.detours.map(
            (node) => `- ${line(node)} · ${node.signal} · fork: ${node.forkNodeId ?? 'unknown'}`,
          )
        : ['- none']),
    ].join('\n'),
    [
      'Candidate mainline (nodes and the edges among them; the exploration map highlights exactly what you mark):',
      `- nodeIds: ${skeleton.mainline.nodeIds.join(', ') || 'none'}`,
      ...skeleton.mainline.edges.map(
        (edge) => `- edge ${edge.id}: ${edge.source} -[${edge.kind}]-> ${edge.target}`,
      ),
    ].join('\n'),
    `Graph cursor: ${skeleton.graphCursor ?? 'none'}`,
    [
      'What to do:',
      submission.kind === 'cli'
        ? `1. Inspect the Goal, its findings and deliverables as needed (\`lh goal show ${graph.goal.id} --json\`). The skeleton is a starting point, not the answer.`
        : '1. Inspect the Goal, its findings and deliverables as needed. The skeleton is a starting point, not the answer.',
      '2. Split the main path into a few chapters. Give each a title and a narrative of what was tried, what was learned and what it produced; list in its nodeIds the mainline nodes it tells (resolved main-path nodes only), plus findingIds and workVersionIds. Every mainline task or experiment node, including the acceptance node when it is on the mainline, must be told by some chapter.',
      skeleton.detours.length
        ? `3. Tell the detours. The skeleton lists ${skeleton.detours.length} candidate detour(s), and at least one MUST appear in your report. Put each detour you tell in the \`detours\` array of the chapter it forked from — a detour entry has title, nodeIds, kind (dead_end | superseded | retry), the reason it was abandoned and the lesson it taught. Add the others that teach something and leave out only those that teach nothing. A report with no detour is incomplete and will be rejected.`
        : '3. Decide which detours are worth telling. For each one attach it to the chapter it forked from, with kind (dead_end | superseded | retry), the reason it was abandoned and the lesson it taught. Leave out detours that teach nothing.',
      '4. Write nextSteps: what remains or should come next, each with a reason.',
      '5. Write a one-sentence headline. When the Goal produced a final deliverable, set deliverableWorkId to that Work\'s id; when there is no final deliverable, omit deliverableWorkId entirely — do not send an empty string or a placeholder such as "none".',
      "6. Mark the mainline: the path that actually led to the result. mainline.nodeIds are the resolved tasks on the correct path (plus, when useful, the resolved root problem and the findings that carried the answer forward); mainline.edgeIds are the ids of this Goal's edges that connect two of those nodes — copy the ids from the Candidate mainline list, never the edge kind. Detour nodes are never on the mainline. The chapters must tell exactly this path: every chapter nodeId is a mainline node, and every mainline task or experiment node — including the acceptance node when it is listed — appears in some chapter.",
      '7. Do NOT restate acceptance verdicts or user decisions as data; the page reads those from their own records. Narrate around them.',
      submission.kind === 'cli'
        ? `8. Write the metadata (headline, deliverableWorkId, chapters, mainline, nextSteps, graphCursor) as JSON to a file, and the full written report in markdown, built from that same metadata, to another file. Submit both once with \`lh goal report ${graph.goal.id} --metadata-file <json> --content-file <md>\`. If it rejects a reference, fix the file and submit again.`
        : `8. Call ${submission.toolName} once with goalId, the metadata (headline, deliverableWorkId, chapters, mainline, nextSteps, graphCursor) and content: the full written report in markdown, built from that same metadata. If it rejects a reference, fix it and call again.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
};

/**
 * The requirement promises the storyline explains the exploration, detours
 * included, and the skeleton hands the wrap-up agent the dead ends it found.
 * A weak default model can narrate the whole path and still submit an empty
 * `detours` array; rejecting the whole report for that leaves the user with no
 * storyline at all — worse than the bug. So the store fills a report that tells
 * no detour from the candidates the skeleton already found — the graph's own
 * record of each dead end — attaching each to the chapter that narrates the
 * node it forked from.
 *
 * Authored detours are never touched: a report that tells any detour is
 * returned unchanged, and the narrative stays exactly what the agent wrote.
 */
export const backfillGoalReportDetours = (
  source: GoalGraphSnapshot,
  metadata: GoalReportMetadata,
): GoalReportMetadata => {
  const candidates = buildGoalReportSkeleton(source).detours;
  if (candidates.length === 0) return metadata;

  const told = new Set(
    metadata.chapters.flatMap((chapter) => chapter.detours.flatMap((detour) => detour.nodeIds)),
  );
  if (candidates.some((candidate) => told.has(candidate.id))) return metadata;

  const nodes = new Map(withoutGoalReport(source).nodes.map((node) => [node.id, node]));
  const chapterFor = (forkNodeId?: string) =>
    metadata.chapters.find((chapter) => !!forkNodeId && chapter.nodeIds.includes(forkNodeId)) ??
    metadata.chapters.find((chapter) => chapter.nodeIds.length > 0) ??
    metadata.chapters[0];

  const additions = new Map<number, GoalReportMetadata['chapters'][number]['detours']>();
  for (const candidate of candidates) {
    const chapter = chapterFor(candidate.forkNodeId);
    if (!chapter) continue;
    const index = metadata.chapters.indexOf(chapter);
    // The graph only carries the node's own description; it holds both why the
    // path was abandoned and what it taught, so it seeds both fields.
    const detail = nodes.get(candidate.id)?.description?.trim() || candidate.signal;
    additions.set(index, [
      ...(additions.get(index) ?? []),
      {
        kind: candidate.signal.startsWith('superseded') ? 'superseded' : 'dead_end',
        lesson: detail,
        nodeIds: [candidate.id],
        reason: detail,
        title: candidate.title,
      },
    ]);
  }
  if (additions.size === 0) return metadata;

  return {
    ...metadata,
    chapters: metadata.chapters.map((chapter, index) => {
      const extra = additions.get(index);
      return extra ? { ...chapter, detours: [...chapter.detours, ...extra] } : chapter;
    }),
  };
};

/**
 * Keep a submitted storyline self-consistent, so a near-miss from the default
 * model still yields the report the requirement promises instead of nothing:
 *
 * - A detour is never a main-path node: a candidate detour the agent listed in
 *   a chapter's own `nodeIds` is pulled out (it belongs in that chapter's
 *   `detours`).
 * - The highlighted mainline must be the path the chapters tell: a mainline
 *   task/experiment no chapter narrates is dropped, and edges left dangling are
 *   pruned. Findings and the root problem may ride along without a chapter.
 * - When the agent tells no detour at all but the skeleton found candidates, they
 *   are attached from the graph's own record.
 *
 * A fully consistent report is returned unchanged.
 */
export const alignGoalReportStoryline = (
  source: GoalGraphSnapshot,
  metadata: GoalReportMetadata,
): GoalReportMetadata => {
  const graph = withoutGoalReport(source);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const detourIds = new Set(buildGoalReportSkeleton(source).detours.map((detour) => detour.id));

  const chapters = metadata.chapters.map((chapter) => {
    const nodeIds = chapter.nodeIds.filter((id) => !detourIds.has(id));
    return nodeIds.length === chapter.nodeIds.length ? chapter : { ...chapter, nodeIds };
  });

  // A missing mainline is the validator's to report, not ours to invent.
  if (!metadata.mainline) return { ...metadata, chapters };

  const chaptered = new Set(chapters.flatMap((chapter) => chapter.nodeIds));
  const narrated = metadata.mainline.nodeIds.filter((id) => {
    const node = byId.get(id);
    if (!node || node.status !== 'resolved' || !CHAPTERED_KINDS.has(node.kind)) return true;
    return chaptered.has(id);
  });
  // Never empty the mainline: `GoalReportMetadataSchema` requires at least one node, and an
  // emptied mainline is persisted, fails the schema on the next read, and takes the whole
  // recovered storyline down with it. Keeping the agent's own nodes lets the validator ask
  // for the missing chapters instead of losing the report.
  const nodeIds = narrated.length > 0 ? narrated : metadata.mainline.nodeIds;
  const onMainline = new Set(nodeIds);
  const edgeById = new Map(source.edges.map((edge) => [edge.id, edge]));
  const edgeIds = metadata.mainline.edgeIds.filter((id) => {
    const edge = edgeById.get(id);
    return !edge || (onMainline.has(edge.sourceNodeId) && onMainline.has(edge.targetNodeId));
  });

  return { ...metadata, chapters, mainline: { ...metadata.mainline, edgeIds, nodeIds } };
};

/** Reconcile a submitted report with the graph before it is validated. */
export const reconcileGoalReport = (
  source: GoalGraphSnapshot,
  metadata: GoalReportMetadata,
): GoalReportMetadata =>
  backfillGoalReportDetours(source, alignGoalReportStoryline(source, metadata));

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
  const candidateDetours = buildGoalReportSkeleton(source).detours;
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

  // The requirement promises the storyline explains the exploration, detours
  // included. A weak default model silently drops every detour the skeleton
  // offered, which the user only notices as a missing chapter — so the contract
  // makes them observable: when the skeleton found candidate detours, a report
  // that tells none is incomplete and must be fixed, never stored.
  const toldDetours = metadata.chapters.reduce(
    (total, chapter) => total + chapter.detours.length,
    0,
  );
  if (candidateDetours.length > 0 && toldDetours === 0)
    errors.push(
      `chapters: the skeleton offers ${candidateDetours.length} candidate detour(s) (${candidateDetours
        .map((detour) => detour.id)
        .join(', ')}); the report must tell at least one detour, with its reason and lesson`,
    );

  metadata.nextSteps.forEach((step, index) => {
    for (const id of step.nodeIds ?? []) {
      if (!byId.has(id))
        errors.push(`nextSteps[${index}].nodeIds: ${id} is not a node of this Goal`);
    }
  });

  errors.push(...validateMainline(graph, metadata));

  if (metadata.deliverableWorkId && !workIds.has(metadata.deliverableWorkId))
    errors.push(
      `deliverableWorkId: ${metadata.deliverableWorkId} is not a Work linked to this Goal`,
    );

  if (options.eventIds && !options.eventIds.has(metadata.graphCursor))
    errors.push(`graphCursor: ${metadata.graphCursor} is not an event of this Goal`);

  return errors;
};

const MAINLINE_KINDS = new Set(['problem', 'task', 'experiment', 'finding']);
/** Mainline nodes a chapter must tell; the root question and findings ride along without one. */
const CHAPTERED_KINDS = new Set(['task', 'experiment']);

/**
 * The mainline must be a real path through this Goal: resolved nodes only, edges
 * of this Goal whose both ends are on it, and the same path the chapters tell —
 * so the highlighted map and the storyline can never disagree.
 */
const validateMainline = (graph: GoalGraphSnapshot, metadata: GoalReportMetadata): string[] => {
  const { mainline } = metadata;
  if (!mainline)
    return ['mainline: required — mark the nodes and edges of the path that led to the result'];

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const onMainline = new Set(mainline.nodeIds);
  const errors: string[] = [];

  for (const id of mainline.nodeIds) {
    const node = byId.get(id);
    if (!node) errors.push(`mainline.nodeIds: ${id} is not a node of this Goal`);
    else if (!MAINLINE_KINDS.has(node.kind))
      errors.push(
        `mainline.nodeIds: ${id} is a ${node.kind}; only problem, task, experiment and finding nodes can be on the mainline`,
      );
    else if (node.status !== 'resolved')
      errors.push(`mainline.nodeIds: ${id} is ${node.status}; mainline nodes must be resolved`);
  }

  for (const id of mainline.edgeIds) {
    const edge = edgeById.get(id);
    if (!edge) {
      errors.push(`mainline.edgeIds: ${id} is not an edge of this Goal`);
      continue;
    }
    const outside = [edge.sourceNodeId, edge.targetNodeId].filter((end) => !onMainline.has(end));
    if (outside.length > 0)
      errors.push(
        `mainline.edgeIds: ${id} connects ${outside.join(', ')}, which is not a mainline node`,
      );
  }

  const chaptered = new Set<string>();
  metadata.chapters.forEach((chapter, index) => {
    for (const id of chapter.nodeIds) {
      chaptered.add(id);
      if (byId.has(id) && !onMainline.has(id))
        errors.push(`chapters[${index}].nodeIds: ${id} is not on the mainline`);
    }
    chapter.detours.forEach((detour, detourIndex) => {
      for (const id of detour.nodeIds) {
        if (onMainline.has(id))
          errors.push(
            `chapters[${index}].detours[${detourIndex}].nodeIds: ${id} is on the mainline; a detour cannot be`,
          );
      }
    });
  });

  for (const id of mainline.nodeIds) {
    const node = byId.get(id);
    // An invalid mainline node was already reported above; asking to tell it too is noise.
    if (node?.status === 'resolved' && CHAPTERED_KINDS.has(node.kind) && !chaptered.has(id))
      errors.push(`mainline.nodeIds: ${id} is on the mainline but no chapter tells it`);
  }

  return errors;
};
