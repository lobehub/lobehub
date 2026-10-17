import type { GoalNodeStatus } from './goal';

/**
 * Batch rollout trigger. `off`/absent keeps the ordinary decomposition: a goal
 * that is not one repeated mould never grows a batch node, and the coordinator
 * reads none of the rollout code paths. `canary` probes first, proves the class
 * is fully automatic at a gate, then releases the rest in waves; `full` skips
 * the probe and delivers every unit as one wave.
 */
export type GoalRolloutTrigger = 'canary' | 'full' | 'off';

/**
 * One axis the repeated units vary along. Recorded so the gate can refuse a
 * green whose coverage never took a value on some axis — the half the probe
 * happened to miss (a `cold-start` value discovered only later).
 */
export interface GoalRolloutVariantAxis {
  /** Axis name, e.g. "cold-start", "auth-boundary". */
  axis: string;
  /** Concrete values the repeated units take on this axis. */
  values: string[];
}

/**
 * Batch rollout policy. Lives on the JSONB `config` column like the other goal
 * policies — the graph's own vocabulary (`goal_nodes.kind`) carries the shape,
 * so nothing here needs a schema of its own.
 */
export interface GoalRolloutPolicy {
  /** Probe size K — how many representative units run before the gate. */
  canarySize?: number;
  /**
   * How many structurally identical units make one batch worth gating. Below it
   * the ordinary per-unit decomposition is cheaper than the ceremony.
   */
  minHomogeneousUnits?: number;
  /** Why the planner judged this batch homogeneous; kept for the gate report. */
  spec?: {
    /** R2 condition: after masking concrete names, is the transform still one? */
    repeatable: boolean;
    /** The reusable transformation, in the planner's words. */
    recipeOutline?: string;
    variantAxes?: GoalRolloutVariantAxis[];
  };
  trigger: GoalRolloutTrigger;
  /**
   * Notes for individual roster units, keyed by unit title. A main Agent that
   * declares the batch can give each unit its own pointers (files, edge cases);
   * a released unit's brief is the recipe plus its note.
   */
  unitBriefs?: Record<string, string>;
  /**
   * Roster of every homogeneous unit in the goal, probes included and in
   * delivery order. Probes are the first, fully-briefed units; the coordinator
   * materializes the rest from here one wave at a time, so the graph never
   * shows the whole fan-out at build time.
   */
  units?: string[];
  /** Mass wave size M — how many units are released per wave after the gate. */
  waveSize?: number;
}

/**
 * One condition the release gate judged. Mirrors `evaluateRolloutGate`: the
 * same keys, in the same order, with what each one found — so the person can see
 * why a gate passed or held, not only that it did.
 */
export type GoalRolloutGateCheckKey =
  'axes_covered' | 'no_open_decision' | 'plan_written' | 'units_settled' | 'units_succeeded';

export interface GoalRolloutGateCheck {
  /** For a count check: how many of `total` held, e.g. 5 of 5 units ran through. */
  count?: number;
  /** Free-form specifics, such as an uncovered `axis=value`. */
  details?: string[];
  key: GoalRolloutGateCheckKey;
  /** The nodes the check is about — the units that failed, the open decision. */
  nodeIds?: string[];
  passed: boolean;
  total?: number;
}

/**
 * One gate verdict and what the coordinator did with it. Appended on every
 * release and every hold, so the gate keeps its own record instead of the
 * decision's prose being the only trace.
 */
export interface GoalRolloutGateEvaluation {
  /** Who approved a release; absent on holds and on releases from before approvals existed. */
  approvedBy?: 'agent' | 'user';
  /** ISO time of the verdict. */
  at: string;
  /** What the gate judged; empty when a unit's own check held the batch (R6). */
  checks: GoalRolloutGateCheck[];
  /** The coordinator's English summary, kept for the trace. */
  message?: string;
  /** The unit whose own check held the batch, when `trigger` is `unit`. */
  nodeId?: string;
  outcome: 'blocked' | 'released';
  /** Units the release put into the next wave. */
  releasedCount?: number;
  /** The recipe revision (round) this verdict belongs to. */
  revision: number;
  /**
   * 1-based ordinal of this verdict within its round. Written by the
   * coordinator so it keeps counting after older verdicts were dropped.
   */
  seq?: number;
  /** `gate`: the gate judged a settled wave. `unit`: one unit failed its own check. */
  trigger: 'gate' | 'unit';
  /**
   * The roster wave a release put out, counted across every round. Written by
   * the coordinator because the log is capped — counting the kept entries would
   * renumber the history once the oldest fall off.
   */
  wave?: number;
  /** Waves released in this round when the verdict was taken (after a release). */
  waveIndex: number;
}

/**
 * Where a batch rollout currently stands. `release_review`: the gate passed and
 * the next wave waits on a person's approval — always before a round's first
 * mass wave, and later whenever the main Agent escalates a release.
 */
export type GoalRolloutPhase =
  | 'probe'
  | 'assay'
  | 'mass'
  | 'pattern_break'
  | 'release_review'
  /** The owner sent the plan back; the main Agent is rewriting it for the owner to review again. */
  | 'plan_revision'
  | 'done';

/**
 * Who approved releasing one wave. A passed gate only proves the checks held;
 * the release itself is a decision: a person approves a round's first wave, and
 * the main Agent (or a person it escalated to) every later one.
 */
export interface GoalRolloutReleaseApproval {
  at: string;
  by: 'agent' | 'user';
  /** The main Agent's reason, or the person's note. */
  reason?: string;
  /** The recipe revision (round) the approval belongs to. */
  revision: number;
  /** The round's `waveIndex` the approval releases from. */
  waveIndex: number;
}

/**
 * Coordinator-owned rollout progress. Written by decomposition and by the
 * coordinator's own gate moves, never by a policy edit — the same rule that
 * keeps `managerState` server-owned.
 */
/**
 * What one break taught the batch: a rule in the batch's expertise domain,
 * which every later unit's acceptance adds as a clause it must meet.
 */
export interface GoalRolloutLearning {
  /**
   * Legacy: a standalone criterion compiled from the rule by an earlier
   * version. Nothing mounts it — later units' acceptance carries `rule` as a
   * clause of its requirement instead.
   */
  criterionId?: string;
  lessonCode?: string;
  lessonId: string;
  /** The round whose gate broke and taught it. */
  revision: number;
  /** The whole correction, as written — `title` is its one-line label. */
  rule?: string;
  title: string;
}

/** The batch's execution plan, kept as a skill in the user's own skill library. */
export interface GoalRolloutPlanSkill {
  /** The skill bundle's document id. */
  id: string;
  /** The skill's name: units load it as `user-skills:<name>`. */
  name: string;
}

/** One unit a release gate reports on: a probe, or a member of the last released wave. */
export interface GoalReleaseGateUnit {
  /** The unit's own acceptance, when it was verified. */
  acceptance?: { checks?: { failed: number; passed: number; total: number }; id: string };
  /** Deliverables it produced: pull requests, reports, documents. */
  artifacts: { documentId?: string; title: string; type: string; url?: string }[];
  /** The unit's own brief: what it was asked to do. */
  brief?: string;
  nodeId: string;
  /** Runs the unit took; more than one means it was reworked. */
  runs: number;
  status: GoalNodeStatus;
  taskId?: string;
  title: string;
  tokens: number;
}

/**
 * Everything the owner decides a release gate on, frozen when the gate opens.
 * Rides the gate's acceptance round so the review page reads one snapshot
 * instead of reassembling the batch from the live graph.
 */
export interface GoalReleaseGateDossier {
  /** The goal's supervising agent — who reports the gate to the owner. */
  agentId?: string;
  /** Gate checks the coordinator judged; advice, not the decision. */
  checks: GoalRolloutGateCheck[];
  /** The main Agent's reasoning when it brought the release back. */
  diagnosis?: string;
  goalId: string;
  goalTitle: string;
  /**
   * `probes`: the first move from probes to batch execution, always a person's.
   * `escalated`: the main Agent declined to release a later wave.
   * `unattended`: no main Agent could take a later release.
   */
  kind: 'escalated' | 'probes' | 'unattended';
  /** The units the next wave releases, with their own notes. */
  nextWave: { brief?: string; title: string }[];
  /** The recipe every unit follows: the plan skill's current version. */
  plan: { content: string; revision: number; skillId?: string; skillName?: string };
  /** Units still owed after the next wave. */
  remainingAfter: number;
  /** Units the decision is judged on, in display order. */
  units: GoalReleaseGateUnit[];
  /** 1-based roster wave the decision releases. */
  wave: number;
}

export interface GoalRolloutState {
  /** The gate (Assay) decision node, once decomposition created it. */
  assayNodeId?: string;
  /** The `batch` container node. */
  batchNodeId: string;
  /**
   * Gate verdicts, oldest first. Each round keeps its most recent few, so a
   * round that was judged never loses its latest verdict to later rounds.
   */
  gateLog?: GoalRolloutGateEvaluation[];
  /** The expertise domain the batch's breaks teach, once one has. */
  learningDomainId?: string;
  /** Every rule a break taught, oldest first. */
  learnings?: GoalRolloutLearning[];
  /**
   * Node ids of the mass tasks the current round released, oldest wave first.
   * A restarted canary starts a new round and clears it.
   */
  massNodeIds?: string[];
  /**
   * The owner's correction a sent-back release waits on, while the phase is
   * `plan_revision`. The main Agent rewrites the plan from it (`revisedRecipe`);
   * once it lands the rewrite returns to the owner's release review.
   */
  pendingRevision?: { correction: string; revisedReason?: string; revisedRecipe?: string };
  /** Phase the rollout is in; the coordinator reads this to pick its move. */
  phase: GoalRolloutPhase;
  /** The execution plan as a user skill; each Template revision is one of its versions. */
  planSkill?: GoalRolloutPlanSkill;
  /**
   * The plan skill version each round runs on, by round (`templateRevision`).
   * A round's plan can be rewritten in place — the owner sends it back at its
   * release gate and the main Agent rewrites it — so a round is not always on
   * the version numbered after it. Absent entries mean version = round.
   */
  planVersions?: Record<string, number>;
  /** Node ids of the probe tasks that must run before the gate passes. */
  probeNodeIds: string[];
  /**
   * The approval the next wave is released on. Valid only for the round and
   * `waveIndex` it names, so a release never rides on an earlier wave's approval.
   */
  releaseApproval?: GoalRolloutReleaseApproval;
  /** How many roster entries have been materialized (probes + released waves). */
  releasedCount?: number;
  /** The acceptance the held release is reviewed on, when one could be opened. */
  releaseGateAcceptanceId?: string;
  /** The decision node a held release waits on, while the phase is `release_review`. */
  releaseReviewNodeId?: string;
  /** Node id of the current Template (finding) node. */
  templateNodeId?: string;
  /** Current Template revision; incremented each time the recipe is revised. */
  templateRevision: number;
  /**
   * The class still to deliver, in delivery order; probes come first. Starts as
   * the full roster. A pattern break re-cuts it to what is still owed — the
   * re-opened probes, the broken units past the canary size, then whatever was
   * never released — so waves deliver only the remainder and units already
   * delivered under the old recipe drop out.
   */
  unitTitles?: string[];
  /** How many mass waves have been released. */
  waveIndex: number;
  /** Roster waves released so far across every round; `waveIndex` restarts per round. */
  wavesReleased?: number;
}
