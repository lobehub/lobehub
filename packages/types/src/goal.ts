import type { InitialGoalOverviewContext } from './stepContext';
import type { WorkType } from './work';

// ============================================
// Goal — independent target entity (`goals` table)
// ============================================

/**
 * Goal lifecycle states. Unlike `tasks`, whose status is about execution, a
 * goal's status is about the whole acceptance loop — including human review
 * (`review`) and the terminal `achieved` outcome.
 *
 * Kept in sync with `goalStatuses` in `@lobechat/const/goal` (type-tested
 * there), mirroring the AcceptanceStatus convention.
 */
export type GoalStatus =
  'planning' | 'running' | 'verifying' | 'review' | 'paused' | 'achieved' | 'failed' | 'canceled';

/**
 * The execution carrier a goal is optionally bound to. Goals are standalone
 * today: the Goal Graph owns execution and dispatches its own Tasks, so
 * nothing binds a goal to a single carrier row. The column stays because
 * existing rows still carry the earlier `task` value.
 */
export type GoalSubjectType = 'task' | 'topic' | 'standalone';

/** Automatic recovery policy for Goal Graph Tasks. */
export interface GoalRecoveryPolicy {
  /** Maximum execution attempts for one Task before escalating to a decision gate. */
  maxAttemptsPerTask?: number;
  /** Per-operation agent step limit. Null/undefined leaves the runtime uncapped. */
  maxStepsPerRun?: number | null;
  /** Time without a durable runtime lease refresh before a running Task is reclaimed. */
  operationLeaseTimeoutMs?: number;
}

/**
 * Calendar-time bounds for a long-horizon goal. Lives on the JSONB `config`
 * column deliberately: attempts, rounds and dollars measure one agent run,
 * but a goal that runs for months also needs "stop trying by this date" as a
 * first-class budget unit, and that needs no schema of its own.
 */
export interface GoalSchedulePolicy {
  /**
   * ISO-8601 instant. Past it the coordinator stops dispatching new Tasks and
   * pauses the goal — the temporal twin of `budget_exhausted`.
   */
  deadline?: string | null;
}

/**
 * The goal's structured acceptance standard. The drafted criteria persist as
 * `verify_criteria` rows (viewable and editable on the goal page); this block
 * records their ids so the terminal Goal-acceptance Task verifies against
 * exactly these checks instead of re-deriving them from the requirement prose.
 */
/** Comparison a measured value must satisfy. */
export type GoalMetricComparison = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

/**
 * A numeric acceptance clause: "this series must read at least this much".
 *
 * The counterpart to a delivery contract judged by a verifier — "followers >=
 * 1,000,000" is not a document someone reads, it is a number that gets
 * measured. `key` addresses a series on the goal itself (subjectType `goal`,
 * subjectId the goal id), so a criterion needs no id of its own and survives
 * the series being re-created.
 */
export interface GoalMetricCriterion {
  /** Metric series key on this goal, e.g. 'twitter.followers'. */
  key: string;
  /** Defaults to `gte` — the "reach this number" case. */
  op?: GoalMetricComparison;
  target: number;
}

/**
 * Upper bound on declared numeric clauses. Every clause is read on each
 * terminal tick, and an unbounded list would let one goal's acceptance payload
 * pace the coordinator (and its database pool) for everyone else.
 */
export const MAX_GOAL_METRIC_CRITERIA = 20;

export interface GoalAcceptancePolicy {
  criteriaIds?: string[];
  /**
   * Measured clauses that gate acceptance. Every one must hold before the
   * Goal-level delivery acceptance is even attempted: an unmet number is not
   * something a verifier can talk its way past, and running the acceptance
   * agent against it would only spend tokens to restate the gap.
   */
  metrics?: GoalMetricCriterion[];
}

/**
 * Who a goal's current pause belongs to, recorded whenever one is taken.
 *
 * Runtime bookkeeping rather than policy: without it, an event that clears the
 * coordinator's reason cannot tell a park it owns from a pause a person chose,
 * and would restart a goal somebody deliberately stopped. A person's claim is
 * stored explicitly rather than as the absence of a marker, because pausing an
 * already-paused goal is a no-op that leaves no other trace of who asked.
 */
export type GoalPauseReason = 'measured_acceptance' | 'user';

export interface GoalConfig {
  acceptance?: GoalAcceptancePolicy;
  /**
   * How many of a goal's Tasks may be in flight at once. Independent Tasks are
   * the common case — four bug fixes that share no code have no reason to run
   * one after another — but an uncapped fan-out would spend the whole budget
   * before the first result came back. Null/undefined uses the default.
   */
  maxConcurrentTasks?: number | null;
  /** Who the current pause belongs to; cleared when the goal runs again. */
  pausedBy?: GoalPauseReason;
  recovery?: GoalRecoveryPolicy;
  schedule?: GoalSchedulePolicy;
}

/**
 * The goal entity as exposed to clients — a mirror of the `goals` table row.
 * Everything execution-specific (rounds run, cost spent, acceptance checks)
 * stays on the carrier and is derived at read time, never denormalized here.
 */
export interface GoalItem {
  agentId: string | null;
  completedAt: Date | null;
  config: GoalConfig | null;
  createdAt: Date;
  id: string;
  /** Round budget; null = uncapped. */
  maxRounds: number | null;
  /** Total USD budget across all rounds; null = uncapped. */
  maxTotalCost: number | null;
  projectId: string | null;
  /** "What counts as done" — the acceptance requirement source. */
  requirement: string | null;
  startedAt: Date | null;
  status: GoalStatus;
  subjectId: string | null;
  subjectType: GoalSubjectType | null;
  title: string;
  updatedAt: Date;
  userId: string;
  workspaceId: string | null;
}

// ============================================
// Goal Graph — durable long-horizon reasoning structure
// ============================================

/** Coarse-grained semantic role of a node in a Goal Graph. */
export type GoalNodeKind = 'problem' | 'task' | 'finding' | 'decision';

/** Semantic lifecycle of a node; independent from the execution status of its Task. */
export type GoalNodeStatus =
  'proposed' | 'active' | 'waiting' | 'resolved' | 'rejected' | 'retired';

/** How two Goal Graph nodes are related. */
export type GoalEdgeKind =
  | 'decomposes'
  | 'depends_on'
  | 'investigates'
  | 'produces'
  | 'supports'
  | 'contradicts'
  | 'leads_to';

/** The role an immutable Work version plays for a Goal Graph node. */
export type GoalNodeWorkVersionRelation = 'input' | 'produced' | 'supports' | 'contradicts';

export type GoalDecisionAuthority = 'agent' | 'user' | 'project_role';

export type GoalDecisionStatus = 'pending' | 'resolved' | 'canceled';

export interface GoalDecisionOption {
  description?: string;
  id: string;
  label: string;
}

export type GoalEventActorType = 'agent' | 'user' | 'system';

export type GoalEventEntityType = 'goal' | 'node' | 'edge' | 'decision' | 'task';

/**
 * Who a Goal Graph mutation is recorded as. Defaults to the acting user; the
 * coordinator supplies its own so its moves are separable from a person's.
 */
export interface GoalEventActor {
  id: string;
  type: GoalEventActorType;
}

export type GoalEventType =
  'created' | 'updated' | 'activated' | 'resolved' | 'rejected' | 'retired' | 'linked' | 'unlinked';

export interface GoalGraphNode {
  confidence: string | null;
  createdAt: Date;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  description: string | null;
  goalId: string;
  id: string;
  kind: GoalNodeKind;
  priority: number;
  resolvedAt: Date | null;
  status: GoalNodeStatus;
  taskId: string | null;
  title: string;
  updatedAt: Date;
}

export interface GoalGraphEdge {
  createdAt: Date;
  goalId: string;
  id: string;
  kind: GoalEdgeKind;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface GoalGraphDecision {
  authority: GoalDecisionAuthority;
  canceledAt: Date | null;
  createdAt: Date;
  id: string;
  nodeId: string;
  options: GoalDecisionOption[] | null;
  question: string;
  recommendedOptionId: string | null;
  requestedProjectRole: string | null;
  requestedUserId: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
  resolvedByAgentId: string | null;
  resolvedByUserId: string | null;
  resolvedOptionId: string | null;
  status: GoalDecisionStatus;
  updatedAt: Date;
}

export interface GoalGraphEvent {
  actorId: string | null;
  actorType: GoalEventActorType;
  createdAt: Date;
  entityId: string;
  entityType: GoalEventEntityType;
  eventType: GoalEventType;
  goalId: string;
  id: string;
  operationId: string | null;
  reason: string | null;
  taskId: string | null;
}

export interface GoalGraphWorkVersionLink {
  createdAt: Date;
  id: string;
  nodeId: string;
  relation: GoalNodeWorkVersionRelation;
  /**
   * Display snapshot of the linked Work version, joined at read time so the
   * graph can name a deliverable instead of counting it. Absent only when the
   * version row is gone — the link is kept so the count stays honest.
   */
  work?: GoalGraphWorkVersionDisplay;
  workVersionId: string;
}

/**
 * What a linked Work version shows without a second round-trip. Taken from the
 * immutable version row rather than the live Work: the graph records what the
 * task delivered at that moment, and a title edited later does not rewrite the
 * goal's history.
 */
export interface GoalGraphWorkVersionDisplay {
  /**
   * Proof that a `document` Work is bound to an agent, and therefore openable
   * in-app. It is the binding row's id, NOT a route parameter — the document
   * route resolves {@link resourceId}.
   */
  agentDocumentId?: string;
  /** Durable download target of a `file` Work, which keeps it out of `url`. */
  fileUrl?: string;
  identifier: string | null;
  /** Canonical resource identity — the document id an in-app link addresses. */
  resourceId: string | null;
  status: string | null;
  title: string | null;
  type: WorkType;
  /** Canonical http(s) open target, for Works that live outside the app. */
  url: string | null;
  workId: string;
}

export interface GoalGraphSnapshot {
  decisions: GoalGraphDecision[];
  edges: GoalGraphEdge[];
  events: GoalGraphEvent[];
  goal: GoalItem;
  nodes: GoalGraphNode[];
  /**
   * Live heartbeat per active task node id: the `agent_operations.updatedAt`
   * of the run behind it. The runtime refreshes that lease every ~90s, while
   * `goal_nodes.updatedAt` only moves on observations / status changes —
   * liveness judgements must use whichever of the two is newer.
   */
  runHeartbeats?: Record<string, Date>;
  /**
   * Rounds run and dollars spent so far, by the definition the coordinator
   * enforces the budget against. Present on a fetched graph; absent on the
   * snapshots the write paths return.
   */
  spend?: GoalSpend;
  workVersions: GoalGraphWorkVersionLink[];
}

/** What a goal has spent against what it is allowed to spend. */
export interface GoalSpend {
  /**
   * The same spend split per Task node, so the cost panel can say WHERE the
   * money went rather than only how much is left.
   */
  byTask: GoalTaskSpend[];
  /** Runs the graph's Task nodes produced — what `maxRounds` is counted in. */
  runs: number;
  /** USD across those runs; a run that has not settled contributes 0. */
  totalCost: number;
  /** Tokens across those runs; a run that has not settled contributes 0. */
  totalTokens: number;
}

/** One Task's share of a goal's spend. */
export interface GoalTaskSpend {
  runs: number;
  taskId: string;
  totalCost: number;
  totalTokens: number;
}

/**
 * Distill a graph snapshot into the structured goal overview that rides
 * `RuntimeInitialContext.goalOverview`. Shared by every transport (client
 * executor, gateway → server pipeline) so they ship identical data; the
 * context-engine injector owns rendering it into prompt text.
 */
export const buildGoalOverviewContext = (
  snapshot: GoalGraphSnapshot,
): InitialGoalOverviewContext => {
  let taskSeq = 0;
  return {
    findings: snapshot.nodes.filter((node) => node.kind === 'finding').map((node) => node.title),
    goal: {
      requirement: snapshot.goal.requirement,
      status: snapshot.goal.status,
      title: snapshot.goal.title,
    },
    pendingDecisions: snapshot.decisions
      .filter((decision) => decision.status === 'pending')
      .map((decision) => ({ question: decision.question })),
    tasks: snapshot.nodes
      .filter((node) => node.kind === 'task')
      .map((node) => ({ seq: ++taskSeq, status: node.status, title: node.title })),
  };
};

export type GoalTickOutcome =
  'advanced' | 'achieved' | 'waiting_human' | 'waiting_external' | 'no_progress' | 'failed';

export interface GoalTickResult {
  goalId: string;
  message: string;
  nodeId?: string;
  outcome: GoalTickOutcome;
  taskId?: string;
}
