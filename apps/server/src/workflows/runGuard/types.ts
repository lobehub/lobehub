/**
 * Prefix shared by all workflow run guard Redis keys.
 *
 * Use when:
 * - Building guard keys for mutation or lookup.
 * - Scanning workflow run guard state.
 *
 * Expects:
 * - Callers append a scope segment after the prefix.
 *
 * Returns:
 * - The stable namespace prefix for run guard keys.
 */
export const WORKFLOW_RUN_GUARD_KEY_PREFIX = 'workflow:run-guard';

/**
 * Default expiration for workflow run guard entries in seconds.
 *
 * Use when:
 * - A caller creates a guard without specifying an explicit TTL.
 *
 * Expects:
 * - Store implementations apply the value as seconds.
 *
 * Returns:
 * - One hour in seconds.
 */
export const WORKFLOW_RUN_GUARD_DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Maximum supported expiration for workflow run guard entries in seconds.
 *
 * Use when:
 * - Validating user or admin supplied TTL values.
 *
 * Expects:
 * - Store implementations clamp or reject values above this limit.
 *
 * Returns:
 * - Twenty-four hours in seconds.
 */
export const WORKFLOW_RUN_GUARD_MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * Policy attached to a workflow run guard value.
 */
export interface WorkflowRunGuardPolicy {
  /**
   * Whether downstream QStash work should be canceled when this guard matches.
   */
  cancelQstash?: boolean;
}

/**
 * Serialized value stored for a workflow run guard key.
 */
export interface WorkflowRunGuardValue {
  /**
   * ISO timestamp indicating when the guard was created.
   */
  createdAt?: string;

  /**
   * Optional behavior controls to apply when the guard matches.
   */
  policy?: WorkflowRunGuardPolicy;

  /**
   * Human-readable reason for blocking workflow execution.
   */
  reason?: string;

  /**
   * Original step name for step-scoped guards.
   */
  stepName?: string;
}

/**
 * Scope used when checking whether a workflow run should be blocked.
 */
export interface WorkflowRunGuardCheckScope {
  /**
   * Optional workflow step name used for step-level guard checks.
   */
  stepName?: string;

  /**
   * Optional user id used for user-level guard checks.
   */
  userId?: string;

  /**
   * Workflow request path or URL used for path-prefix guard checks.
   */
  workflowPath: string;

  /**
   * Optional workflow run id used for run-level and step-level guard checks.
   */
  workflowRunId?: string;
}

/**
 * Scope accepted when creating or deleting a single workflow run guard key.
 */
export type WorkflowRunGuardMutationScope =
  | { type: 'global' }
  | { type: 'path'; workflowPath: string }
  | { type: 'user'; userId: string }
  | { type: 'run'; workflowRunId: string }
  | { stepName: string; type: 'step'; workflowRunId: string };

/**
 * Scope labels returned by guard key builders and matches.
 */
export type WorkflowRunGuardScopeType = WorkflowRunGuardMutationScope['type'] | 'path-prefix';

/**
 * Candidate key checked while evaluating workflow run guard state.
 */
export interface WorkflowRunGuardKeyCandidate {
  /**
   * Redis key to check.
   */
  key: string;

  /**
   * Logical scope represented by the candidate key.
   */
  scope: WorkflowRunGuardScopeType;
}

/**
 * Matched workflow run guard key and decoded value.
 */
export interface WorkflowRunGuardMatch {
  /**
   * Redis key that matched.
   */
  key: string;

  /**
   * Logical scope represented by the matched key.
   */
  scope: WorkflowRunGuardScopeType;

  /**
   * Decoded guard payload stored at the matched key.
   */
  value: WorkflowRunGuardValue;
}
