import type {
  WorkflowRunGuardCheckScope,
  WorkflowRunGuardMatch,
  WorkflowRunGuardScopeType,
  WorkflowRunGuardValue,
} from './types';

/**
 * Options required to create a workflow run guard error.
 */
export interface WorkflowRunGuardErrorOptions {
  /**
   * Guard match that blocked execution.
   */
  match: WorkflowRunGuardMatch;

  /**
   * Scope being evaluated when the guard matched.
   */
  scope: WorkflowRunGuardCheckScope;
}

/**
 * Error thrown when workflow execution is blocked by a run guard.
 *
 * Use when:
 * - A guard lookup finds a matching block key.
 *
 * Expects:
 * - `match` contains the guard value and Redis key.
 * - `scope` contains the workflow context that was checked.
 *
 * Returns:
 * - An Error carrying both the matched key and checked workflow context.
 */
export class WorkflowRunGuardError extends Error {
  /**
   * Logical guard scope that matched.
   */
  guardScope: WorkflowRunGuardScopeType;

  /**
   * Redis key that blocked the workflow run.
   */
  matchedKey: string;

  /**
   * Human-readable reason from the matched guard value.
   */
  reason?: string;

  /**
   * Step name checked when the guard matched.
   */
  stepName?: string;

  /**
   * User id checked when the guard matched.
   */
  userId?: string;

  /**
   * Decoded guard payload from the matched key.
   */
  value: WorkflowRunGuardValue;

  /**
   * Workflow path checked when the guard matched.
   */
  workflowPath: string;

  /**
   * Workflow run id checked when the guard matched.
   */
  workflowRunId?: string;

  constructor({ match, scope }: WorkflowRunGuardErrorOptions) {
    super(match.value.reason || `Workflow execution blocked by run guard: ${match.key}`);

    this.name = 'WorkflowRunGuardError';
    this.guardScope = match.scope;
    this.matchedKey = match.key;
    this.reason = match.value.reason;
    this.stepName = scope.stepName;
    this.userId = scope.userId;
    this.value = match.value;
    this.workflowPath = scope.workflowPath;
    this.workflowRunId = scope.workflowRunId;
  }
}
