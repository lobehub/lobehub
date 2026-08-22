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
 * The execution carrier a goal is optionally bound to:
 * - `task`       — the `/goal` flow: the goal runs inside a dedicated task.
 * - `topic`      — a goal declared directly in a conversation.
 * - `standalone` — a pure goal declaration with no carrier attached.
 */
export type GoalSubjectType = 'task' | 'topic' | 'standalone';

/**
 * The goal entity as exposed to clients — a mirror of the `goals` table row.
 * Everything execution-specific (rounds run, cost spent, acceptance checks)
 * stays on the carrier and is derived at read time, never denormalized here.
 */
export interface GoalItem {
  agentId: string | null;
  completedAt: Date | null;
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

/**
 * Goal creation payload accepted by `TaskService.createTask` / the `task.create`
 * procedure: binds a new goals row to the created task in the same flow.
 * `maxRounds: null` is the user's explicit "no cap"; `undefined` means they
 * never chose, and the service falls back to the documented default.
 */
export interface CreateTaskGoalInput {
  maxRounds?: number | null;
  maxTotalCost?: number | null;
  requirement?: string | null;
  title?: string;
}

// ============================================
// Goal Graph — durable long-horizon reasoning structure
// ============================================

/** Coarse-grained semantic role of a node in a Goal Graph. */
export type GoalNodeKind = 'problem' | 'work' | 'finding' | 'decision';

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

export type GoalEventType =
  'created' | 'updated' | 'activated' | 'resolved' | 'rejected' | 'retired' | 'linked' | 'unlinked';
