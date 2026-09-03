/**
 * Goal trajectory — the same trace format as {@link ExecutionSnapshot}, one
 * level up.
 *
 * An operation is one complete agent execution and gets one `ExecutionSnapshot`
 * whose steps are LLM/tool calls. A goal is one complete *goal* execution and
 * gets one `GoalTrajectory` whose steps are advances. The nesting closes at the
 * leaf: an advance dispatches a task run, that run is an operation, and its
 * `operationId` is recorded here rather than its content copied — so
 * `agent-tracing inspect <opId>` continues from where the goal trace stops.
 *
 * Graph entities are typed structurally instead of importing `@lobechat/types`,
 * matching how `StepSnapshot.messages` stays loose: a trace format has to keep
 * reading objects written by older code.
 */

/** What caused this advance. `unknown` covers traces written before a caller was labelled. */
export type GoalAdvanceTrigger =
  'create' | 'decide' | 'settle' | 'sweep' | 'resume' | 'budget' | 'manual' | 'unknown';

/** Which arm of the coordinator ran. One per `tick` return path. */
export type GoalTickBranch =
  /** Goal is paused or already terminal — nothing to decide. */
  | 'goal_paused'
  | 'goal_terminal'
  /** A gate is open; the goal is parked on a person. */
  | 'pending_decision'
  /** No task node is eligible: none exists, or all remaining ones are blocked. */
  | 'no_frontier'
  /** The graph has no tasks yet — decompose the goal into explorable directions first. */
  | 'plan_decomposition'
  /** Every task node finished; the goal-level acceptance contract is next. */
  | 'terminal_acceptance'
  /** The chosen task node has no responsible task yet. */
  | 'create_task'
  /** Its task row is gone. */
  | 'missing_task'
  /** Its task finished; fold the outcome into a finding. */
  | 'consume_completed'
  /** Its operation outlived the lease / failed verification — automatic recovery. */
  | 'recover_lease'
  | 'recover_verification'
  /** Recovery is exhausted or the failure is not recoverable; open a gate. */
  | 'failure_decision'
  /** Task is parked or already in flight. */
  | 'task_paused'
  | 'task_running'
  /** Budget stopped the goal before this task could be dispatched. */
  | 'budget_exhausted'
  /** Start a run for the chosen task. */
  | 'dispatch_task';

export type GoalTickOutcome =
  'advanced' | 'achieved' | 'waiting_human' | 'waiting_external' | 'no_progress' | 'failed';

// ==================== Graph state ====================

export interface GoalTraceGoal {
  agentId?: string | null;
  id: string;
  maxRounds?: number | null;
  maxTotalCost?: number | null;
  requirement?: string | null;
  status: string;
  title: string;
}

export interface GoalTraceNode {
  /** Epoch ms. Drives the frontier tie-break, so replay needs it. */
  createdAt: number;
  id: string;
  kind: string;
  priority: number;
  status: string;
  taskId?: string | null;
  title: string;
}

export interface GoalTraceEdge {
  id: string;
  kind: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface GoalTraceDecision {
  id: string;
  nodeId: string;
  question: string;
  resolvedOptionId?: string | null;
  status: string;
}

/** Everything the coordinator reads about the graph when it decides. */
export interface GoalGraphState {
  decisions: GoalTraceDecision[];
  edges: GoalTraceEdge[];
  goal: GoalTraceGoal;
  nodes: GoalTraceNode[];
}

/**
 * Change relative to the previous advance's state. Same baseline+delta shape as
 * `messagesBaseline` / `messagesDelta`: the trajectory carries one full state
 * and every later advance stores only what moved.
 */
export interface GoalGraphDelta {
  decisionsUpserted?: GoalTraceDecision[];
  edgesAdded?: GoalTraceEdge[];
  edgesRemoved?: string[];
  goal?: Partial<GoalTraceGoal>;
  nodesRemoved?: string[];
  nodesUpserted?: GoalTraceNode[];
}

// ==================== Decision input surface ====================

/**
 * A task node that was eligible this tick. Losers are recorded too — without
 * them a trace cannot answer "why not that node", which is the whole point of
 * keeping the input surface rather than the result.
 */
export interface FrontierCandidate {
  blockedBy: string[];
  nodeId: string;
  priority: number;
  status: string;
  title: string;
}

/** Budget as the coordinator read it, not as it looks now. */
export interface GoalBudgetState {
  costLimitReached: boolean;
  /**
   * The goal's calendar-time budget (config.schedule.deadline), evaluated at
   * decision time. Time-based stopping is derived, not stored — a replay of a
   * recorded trajectory must see the same verdict the live run saw, so it
   * travels with the budget rather than being recomputed from the wall clock.
   */
  deadlinePassed?: boolean;
  maxRounds?: number | null;
  maxTotalCost?: number | null;
  roundLimitReached: boolean;
  runs: number;
  totalCost: number;
}

/** A candidate's responsible task at decision time; drives every post-dispatch branch. */
export interface GoalFrontierTaskState {
  error?: string | null;
  id: string;
  identifier?: string;
  /** The task node this task belongs to, so a reader can line the two up. */
  nodeId?: string;
  status: string;
  updatedAt: number;
}

/** Cheap shape metrics — enough to chart convergence without re-folding the graph. */
export interface GoalGraphShape {
  edgesTotal: number;
  findings: number;
  gatesPending: number;
  nodesTotal: number;
  tasksBlocked: number;
  tasksCompleted: number;
  tasksOpen: number;
  tasksReady: number;
}

// ==================== Snapshots ====================

export interface GoalTickSnapshot {
  /** When the coordinator entered this tick. Staleness branches read the clock, so replay needs it. */
  at: number;
  branch: GoalTickBranch;
  /**
   * Absent on branches that never funded anything — a paused goal, an open
   * gate, an empty frontier. Recording a budget the coordinator did not read
   * would put a number in the decision input that never influenced it.
   */
  budget?: GoalBudgetState;
  candidates: FrontierCandidate[];
  /**
   * The responsible task of every candidate that had one. The scheduler reads
   * all of them — it has to know which are in flight before it can decide what
   * else to start — so recording only the chosen one would leave a replay
   * unable to reproduce the decision.
   */
  candidateTasks?: GoalFrontierTaskState[];
  chosenNodeId?: string;
  /** Concurrency cap in force for this tick. */
  concurrency?: number;
  /** What this tick changed. Attributed per tick so an advance's writes stay ordered. */
  effects: GoalAdvanceEffect[];
  /**
   * @deprecated Superseded by `candidateTasks`, which carries every candidate
   * rather than only the chosen one. Still read when replaying trajectories
   * recorded before the scheduler could look past the head of the frontier.
   */
  frontierTask?: GoalFrontierTaskState;
  /**
   * Graph change since the previously recorded tick, observed on entry to this
   * one. Folding every delta up to and including this field reproduces exactly
   * what the coordinator read before it decided — which is what makes replay
   * possible. Ticks carry it rather than advances because an advance runs a
   * loop of them and each one re-reads the graph.
   */
  graphDelta?: GoalGraphDelta;
  graphShape: GoalGraphShape;
  index: number;
  message: string;
  outcome: GoalTickOutcome;
  taskId?: string;
}

export type GoalEffectType =
  | 'created_task'
  | 'started_run'
  | 'opened_decision'
  | 'resolved_decision'
  | 'created_node'
  | 'attached_work_version'
  | 'node_status'
  | 'goal_status'
  | 'released_claim';

export interface GoalAdvanceEffect {
  detail?: string;
  nodeId?: string;
  /** The agent operation this effect put in flight or consumed — the drill-down key. */
  operationId?: string;
  targetId?: string;
  type: GoalEffectType;
}

export interface GoalAdvanceSnapshot {
  /** Operations this advance put in flight. The hand-off to `inspect <opId>`. */
  childOperationIds?: string[];
  completedAt: number;
  durationMs: number;
  error?: { message: string; type: string };
  seq: number;
  startedAt: number;
  ticks: GoalTickSnapshot[];
  trigger: GoalAdvanceTrigger;
}

export interface GoalTrajectory {
  advances: GoalAdvanceSnapshot[];
  completedAt?: number;
  /** Terminal goal status — `achieved` / `failed` / `canceled`. */
  completionReason?: string;
  goalId: string;
  /** State before the first recorded advance; later states fold forward from here. */
  graphBaseline: GoalGraphState;
  startedAt: number;
  title: string;
  totalAdvances: number;
  totalTicks: number;
  traceId: string;
  userId?: string;
}

export interface GoalTraceSummary {
  advances: number;
  completionReason?: string;
  createdAt: number;
  durationMs: number;
  goalId: string;
  title: string;
}
