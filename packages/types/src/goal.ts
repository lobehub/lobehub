import type { InitialGoalOverviewContext } from './stepContext';

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
 * today: the Goal Graph owns execution and dispatches its own Work Tasks, so
 * nothing binds a goal to a single carrier row. The column stays because
 * existing rows still carry the earlier `task` value.
 */
export type GoalSubjectType = 'task' | 'topic' | 'standalone';

/** Automatic recovery policy for Goal Graph Work. */
export interface GoalRecoveryPolicy {
  /** Maximum execution attempts for one Work before escalating to a decision gate. */
  maxAttemptsPerTask?: number;
  /** Per-operation agent step limit. Null/undefined leaves the runtime uncapped. */
  maxStepsPerRun?: number | null;
  /** Time without a durable runtime lease refresh before a running Work is reclaimed. */
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
   * ISO-8601 instant. Past it the coordinator stops dispatching new Work and
   * pauses the goal — the temporal twin of `budget_exhausted`.
   */
  deadline?: string | null;
}

/**
 * The goal's structured acceptance standard. The drafted criteria persist as
 * `verify_criteria` rows (viewable and editable on the goal page); this block
 * records their ids so the terminal Goal-acceptance Work verifies against
 * exactly these checks instead of re-deriving them from the requirement prose.
 */
export interface GoalAcceptancePolicy {
  criteriaIds?: string[];
}

export interface GoalConfig {
  acceptance?: GoalAcceptancePolicy;
  /**
   * How many of a goal's Tasks may be in flight at once. Independent Tasks are
   * the common case — four bug fixes that share no code have no reason to run
   * one after another — but an uncapped fan-out would spend the whole budget
   * before the first result came back. Null/undefined uses the default.
   */
  maxConcurrentTasks?: number | null;
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
  workVersionId: string;
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
  workVersions: GoalGraphWorkVersionLink[];
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
  let workSeq = 0;
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
    work: snapshot.nodes
      .filter((node) => node.kind === 'task')
      .map((node) => ({ seq: ++workSeq, status: node.status, title: node.title })),
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
