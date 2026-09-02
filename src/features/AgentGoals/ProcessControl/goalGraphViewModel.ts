import type {
  GoalGraphDecision,
  GoalGraphEdge,
  GoalGraphEvent,
  GoalGraphNode,
  GoalGraphSnapshot,
  GoalItem,
} from '@lobechat/types';

/**
 * Read model for the Goal process-control surface.
 *
 * Everything here is derived from one `goal.graph` snapshot — the server has no
 * frontier projection, no per-node attempt/cost roll-up and no artifact
 * hydration, so the client reproduces the coordinator's own selection rule
 * (`GoalService.tick`) and reads the append-only `goal_events` trail for the
 * per-node attempt ledger. Anything that cannot be derived honestly is left
 * `undefined` and the UI omits it rather than inventing a value.
 */

/** Mirrors the reclaim window the coordinator uses when a Work holds no lease. */
const DEFAULT_LEASE_TIMEOUT_MS = 15 * 60 * 1000;

/** How many just-finished tasks stay visible so the list fades instead of items vanishing. */
export const RECENT_DONE = 2;

const TERMINAL_NODE_STATUSES = new Set(['resolved', 'rejected', 'retired']);

export type GoalAttemptOutcome = 'passed' | 'failed' | 'retired' | 'running';

export interface GoalAttempt {
  endedAt?: Date;
  /** 1-based attempt number on its node. */
  index: number;
  outcome: GoalAttemptOutcome;
  /** The `reason` the coordinator recorded on the closing event. */
  reason?: string;
  startedAt: Date;
  taskId?: string;
}

export interface GoalNodeView {
  /** Problems this finding was linked to with a `supports` edge. */
  answers: GoalGraphNode[];
  /** Registered work versions. Names/urls need a server join that does not exist yet. */
  artifactCount: number;
  attempts: GoalAttempt[];
  /** Unresolved `depends_on` targets — why this node cannot start. */
  blockers: GoalGraphNode[];
  /** Pending user decision opened on this node. */
  decision?: GoalGraphDecision;
  dependsOn: string[];
  /** Findings produced by this Work. */
  findings: GoalGraphNode[];
  /** Decision only: the Work this gate was opened for — its ledger is the case. */
  gateSubjectId?: string;
  /** Latest liveness signal: node row update or the run operation's lease heartbeat. */
  heartbeatAt: Date;
  /** Decisions on this node a human already resolved. */
  humanTouches: GoalGraphDecision[];
  /** Active for longer than the lease window with no heartbeat — the coordinator would reclaim it. */
  isStale: boolean;
  node: GoalGraphNode;
  /** The Work that produced this finding. */
  producedBy?: GoalGraphNode;
  /** Stable 1-based number over Work nodes in graph creation order. */
  seq?: number;
  /** When the current attempt started, for the running clock. */
  startedAt?: Date;
}

export type FrontierItemKind = 'gate' | 'stale' | 'running' | 'ready' | 'done';

export interface FrontierItem {
  key: string;
  kind: FrontierItemKind;
  /** 0 = needs you, 1 = running, 2 = ready, -1 = recently finished. */
  rank: number;
  view: GoalNodeView;
}

export interface GoalGraphView {
  /** Every node the frontier can move now, excluding the fading done rows. */
  advanceable: number;
  blocked: GoalNodeView[];
  byId: Record<string, GoalNodeView>;
  decisions: GoalGraphDecision[];
  edges: GoalGraphEdge[];
  findings: GoalNodeView[];
  frontier: FrontierItem[];
  goal: GoalItem;
  needsYou: number;
  /** Views in graph creation order. */
  nodes: GoalNodeView[];
}

const leaseTimeoutMs = (goal: GoalItem) =>
  goal.config?.recovery?.operationLeaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;

/**
 * Attempt ledger from the audit trail.
 *
 * Only `activated` opens an attempt, and only a *boundary* closes it: the next
 * `activated` (the coordinator started another attempt, so this one did not
 * succeed) or a terminal lifecycle event. `updated` is deliberately not a
 * boundary — the model writes it for bookkeeping too ("Attached Work version
 * …"), so treating it as an outcome ends every attempt one event too early and
 * leaves a live attempt looking finished. Its reason is still the best
 * description of why an attempt ended, so the last one before the boundary is
 * carried onto the attempt.
 *
 * There is no cost or duration per attempt anywhere, so neither is reported.
 */
const buildAttempts = (node: GoalGraphNode, events: GoalGraphEvent[]): GoalAttempt[] => {
  const own = events.filter((e) => e.entityType === 'node' && e.entityId === node.id);
  const attempts: GoalAttempt[] = [];
  let pendingReason: string | undefined;

  const close = (
    outcome: Exclude<GoalAttemptOutcome, 'running'>,
    event: GoalGraphEvent,
    reason?: string,
  ) => {
    const open = attempts.at(-1);
    if (!open || open.outcome !== 'running') return;
    open.endedAt = event.createdAt;
    open.outcome = outcome;
    open.reason = reason;
    open.taskId = open.taskId ?? event.taskId ?? undefined;
  };

  for (const event of own) {
    switch (event.eventType) {
      case 'activated': {
        // A new attempt starting means the previous one did not deliver. Its
        // reason is the last `updated` note, not this event's — that one is the
        // instruction the human attached to the *new* attempt.
        close('failed', event, pendingReason);
        attempts.push({
          index: attempts.length + 1,
          outcome: 'running',
          startedAt: event.createdAt,
          taskId: event.taskId ?? undefined,
        });
        pendingReason = event.reason ?? undefined;
        break;
      }
      case 'rejected':
      case 'retired': {
        close('retired', event, event.reason ?? pendingReason);
        break;
      }
      case 'resolved': {
        close('passed', event, event.reason ?? pendingReason);
        break;
      }
      case 'updated': {
        if (event.reason) pendingReason = event.reason;
        break;
      }
      default: {
        break;
      }
    }
  }

  // A Work parked at a decision gate leaves its last attempt open: the gate is
  // written as `updated`, which is not a boundary. Only an `active` node is
  // still trying, so close the attempt against the node's own state.
  const open = attempts.at(-1);
  if (open?.outcome === 'running' && node.status !== 'active') {
    open.endedAt = node.updatedAt;
    open.outcome = node.status === 'resolved' ? 'passed' : 'failed';
    open.reason = pendingReason;
  }

  return attempts;
};

export const buildGoalGraphView = (
  snapshot: GoalGraphSnapshot,
  now: number = Date.now(),
): GoalGraphView => {
  const { decisions, edges, events, goal, nodes, runHeartbeats, workVersions } = snapshot;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const lease = leaseTimeoutMs(goal);

  const dependsOn = new Map<string, string[]>();
  const producesByWork = new Map<string, GoalGraphNode[]>();
  const gateSubject = new Map<string, string>();
  const producedByFinding = new Map<string, GoalGraphNode>();
  const supportsByFinding = new Map<string, GoalGraphNode[]>();
  for (const edge of edges) {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    if (!source || !target) continue;
    if (edge.kind === 'depends_on')
      dependsOn.set(source.id, [...(dependsOn.get(source.id) ?? []), target.id]);
    if (edge.kind === 'produces') {
      producesByWork.set(source.id, [...(producesByWork.get(source.id) ?? []), target]);
      producedByFinding.set(target.id, source);
    }
    // The coordinator links the failed Work to the gate it opened with `leads_to`.
    if (edge.kind === 'leads_to' && target.kind === 'decision')
      gateSubject.set(target.id, source.id);
    if (edge.kind === 'supports')
      supportsByFinding.set(source.id, [...(supportsByFinding.get(source.id) ?? []), target]);
  }

  const artifactCounts = new Map<string, number>();
  for (const link of workVersions)
    artifactCounts.set(link.nodeId, (artifactCounts.get(link.nodeId) ?? 0) + 1);

  const decisionsByNode = new Map<string, GoalGraphDecision[]>();
  for (const decision of decisions)
    decisionsByNode.set(decision.nodeId, [
      ...(decisionsByNode.get(decision.nodeId) ?? []),
      decision,
    ]);

  let seq = 0;
  const views: GoalNodeView[] = nodes.map((node) => {
    const nodeDecisions = decisionsByNode.get(node.id) ?? [];
    const attempts = buildAttempts(node, events);
    const open = attempts.at(-1);
    const isRunningAttempt = node.status === 'active' && open?.outcome === 'running';
    // Liveness = the newer of the node row (moves on observations / status
    // changes) and the run operation's lease heartbeat (refreshed ~90s while
    // the agent works). Judging from the node row alone flags any long quiet
    // stretch — a big tool call, the verify stage — as lost while the
    // coordinator's reclaim path still sees a healthy lease.
    const heartbeatAt = new Date(
      Math.max(node.updatedAt.getTime(), runHeartbeats?.[node.id]?.getTime() ?? 0),
    );
    return {
      answers: supportsByFinding.get(node.id) ?? [],
      artifactCount: artifactCounts.get(node.id) ?? 0,
      attempts,
      blockers: (dependsOn.get(node.id) ?? [])
        .map((id) => nodeById.get(id))
        .filter((dep): dep is GoalGraphNode => !!dep && !TERMINAL_NODE_STATUSES.has(dep.status)),
      decision: nodeDecisions.find((d) => d.status === 'pending'),
      dependsOn: dependsOn.get(node.id) ?? [],
      findings: producesByWork.get(node.id) ?? [],
      gateSubjectId: gateSubject.get(node.id),
      heartbeatAt,
      humanTouches: nodeDecisions.filter((d) => d.status === 'resolved' && !!d.resolvedByUserId),
      isStale:
        node.kind === 'task' && node.status === 'active' && now - heartbeatAt.getTime() > lease,
      node,
      producedBy: producedByFinding.get(node.id),
      seq: node.kind === 'task' ? ++seq : undefined,
      startedAt: isRunningAttempt ? open.startedAt : undefined,
    };
  });
  const byId = Object.fromEntries(views.map((view) => [view.node.id, view]));

  // The coordinator's own frontier rule (GoalService.tick): a Work whose
  // `depends_on` targets are all resolved. Blocked Work folds instead of listing.
  const frontier: FrontierItem[] = [];
  const blocked: GoalNodeView[] = [];
  for (const view of views) {
    const { node } = view;
    if (node.kind === 'decision' && node.status === 'waiting' && view.decision) {
      frontier.push({ key: node.id, kind: 'gate', rank: 0, view });
      continue;
    }
    if (node.kind !== 'task') continue;
    if (node.status === 'active') {
      frontier.push({
        key: node.id,
        kind: view.isStale ? 'stale' : 'running',
        rank: view.isStale ? 0 : 1,
        view,
      });
      continue;
    }
    if (TERMINAL_NODE_STATUSES.has(node.status) || node.status === 'waiting') continue;
    if (view.blockers.length > 0) blocked.push(view);
    else frontier.push({ key: node.id, kind: 'ready', rank: 2, view });
  }

  const done = views
    .filter((view) => view.node.kind === 'task' && TERMINAL_NODE_STATUSES.has(view.node.status))
    // Recency picks WHICH finished rows stay visible…
    .sort((a, b) => resolvedTime(b.node) - resolvedTime(a.node))
    .slice(0, RECENT_DONE)
    // …but the list displays them in the stable Work numbering (#1, #2, …) —
    // "most recently finished first" reads as the sequence having changed.
    .sort(
      (a, b) =>
        (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
        resolvedTime(a.node) - resolvedTime(b.node),
    )
    .map((view) => ({ key: `done:${view.node.id}`, kind: 'done' as const, rank: -1, view }));

  frontier.sort((a, b) => a.rank - b.rank || b.view.node.priority - a.view.node.priority);

  return {
    advanceable: frontier.length,
    blocked,
    byId,
    decisions,
    edges,
    findings: views.filter((view) => view.node.kind === 'finding'),
    frontier: [...done, ...frontier],
    goal,
    needsYou: frontier.filter((item) => item.rank === 0).length,
    nodes: views,
  };
};

const resolvedTime = (node: GoalGraphNode) =>
  (node.resolvedAt ?? node.updatedAt ?? node.createdAt).getTime();
