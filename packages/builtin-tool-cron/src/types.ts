import type { ExecutionConditions } from '@lobechat/types';

export const CronApiName = {
  /**
   * Create a new scheduled task for an agent
   */
  createCronJob: 'createCronJob',

  /**
   * Delete a scheduled task
   */
  deleteCronJob: 'deleteCronJob',

  /**
   * Get details of a specific cron job
   */
  getCronJob: 'getCronJob',

  /**
   * Get execution statistics for the user's cron jobs
   */
  getStats: 'getStats',

  /**
   * List all cron jobs for an agent
   */
  listCronJobs: 'listCronJobs',

  /**
   * Reset execution count and re-enable a job
   */
  resetExecutions: 'resetExecutions',

  /**
   * Enable or disable a cron job
   */
  toggleCronJob: 'toggleCronJob',

  /**
   * Update an existing cron job
   */
  updateCronJob: 'updateCronJob',
} as const;

export type CronApiNameType = (typeof CronApiName)[keyof typeof CronApiName];

// ==================== Tool Parameter Types ====================

export interface CreateCronJobParams {
  /**
   * The prompt/instructions for the scheduled task
   */
  content: string;
  /**
   * Standard cron pattern (e.g., "0 9 * * *" for 9 AM daily)
   * Minimum interval is 30 minutes
   */
  cronPattern: string;
  /**
   * Optional description of the task
   */
  description?: string;
  /**
   * Whether the job should be enabled immediately (default: true)
   */
  enabled?: boolean;
  /**
   * Maximum number of executions (null = unlimited)
   */
  maxExecutions?: number | null;
  /**
   * Name of the scheduled task
   */
  name: string;
  /**
   * Timezone for the schedule (default: 'UTC')
   * Example: 'America/New_York', 'Asia/Shanghai'
   */
  timezone?: string;
}

export interface CreateCronJobState {
  /**
   * The created cron job data
   */
  cronJob?: CronJobSummary;
  /**
   * Error message if creation failed
   */
  message?: string;
  /**
   * Whether creation was successful
   */
  success: boolean;
}

export interface ListCronJobsParams {
  /**
   * Filter by enabled/disabled status
   */
  enabled?: boolean;
  /**
   * Maximum number of results to return (default: 20, max: 100)
   */
  limit?: number;
  /**
   * Number of results to skip (for pagination)
   */
  offset?: number;
}

export interface ListCronJobsState {
  /**
   * List of cron jobs
   */
  cronJobs: CronJobSummary[];
  /**
   * Pagination info
   */
  pagination?: {
    hasMore: boolean;
    limit: number;
    offset: number;
    total: number;
  };
  /**
   * Whether the query was successful
   */
  success: boolean;
}

export interface GetCronJobParams {
  /**
   * The ID of the cron job to retrieve
   */
  id: string;
}

export interface GetCronJobState {
  /**
   * The cron job details
   */
  cronJob?: CronJobSummary;
  /**
   * Error message if not found
   */
  message?: string;
  /**
   * Whether the query was successful
   */
  success: boolean;
}

export interface UpdateCronJobParams {
  /**
   * New content/prompt for the task
   */
  content?: string;
  /**
   * New cron pattern
   */
  cronPattern?: string;
  /**
   * New description
   */
  description?: string;
  /**
   * Enable or disable the job
   */
  enabled?: boolean;
  /**
   * The ID of the cron job to update
   */
  id: string;
  /**
   * New max executions (null = unlimited)
   */
  maxExecutions?: number | null;
  /**
   * New name for the task
   */
  name?: string;
  /**
   * New timezone
   */
  timezone?: string;
}

export interface UpdateCronJobState {
  /**
   * The updated cron job data
   */
  cronJob?: CronJobSummary;
  /**
   * Error message if update failed
   */
  message?: string;
  /**
   * Whether update was successful
   */
  success: boolean;
}

export interface DeleteCronJobParams {
  /**
   * The ID of the cron job to delete
   */
  id: string;
}

export interface DeleteCronJobState {
  /**
   * Error message if deletion failed
   */
  message?: string;
  /**
   * Whether deletion was successful
   */
  success: boolean;
}

export interface ToggleCronJobParams {
  /**
   * Whether to enable (true) or disable (false) the job
   */
  enabled: boolean;
  /**
   * The ID of the cron job to toggle
   */
  id: string;
}

export interface ToggleCronJobState {
  /**
   * The updated cron job data
   */
  cronJob?: CronJobSummary;
  /**
   * Error message if toggle failed
   */
  message?: string;
  /**
   * Whether toggle was successful
   */
  success: boolean;
}

export interface ResetExecutionsParams {
  /**
   * The ID of the cron job to reset
   */
  id: string;
  /**
   * New max executions value (optional, keeps current if not specified)
   */
  newMaxExecutions?: number;
}

export interface ResetExecutionsState {
  /**
   * The updated cron job data
   */
  cronJob?: CronJobSummary;
  /**
   * Error message if reset failed
   */
  message?: string;
  /**
   * Whether reset was successful
   */
  success: boolean;
}

export interface GetStatsParams {
  // No parameters required - stats are for the current user
}

export interface GetStatsState {
  /**
   * Error message if query failed
   */
  message?: string;
  /**
   * Execution statistics
   */
  stats?: CronStats;
  /**
   * Whether query was successful
   */
  success: boolean;
}

// ==================== Data Types ====================

export interface CronJobSummary {
  /**
   * The agent ID this job belongs to
   */
  agentId: string;
  /**
   * The prompt/instructions for the task
   */
  content: string;
  /**
   * When the job was created
   */
  createdAt: Date;
  /**
   * The cron pattern
   */
  cronPattern: string;
  /**
   * Optional description
   */
  description?: string | null;
  /**
   * Whether the job is enabled
   */
  enabled: boolean | null;
  /**
   * Advanced execution conditions
   */
  executionConditions?: ExecutionConditions | null;
  /**
   * Unique job ID
   */
  id: string;
  /**
   * When the job last executed
   */
  lastExecutedAt?: Date | null;
  /**
   * Maximum number of executions (null = unlimited)
   */
  maxExecutions?: number | null;
  /**
   * Task name
   */
  name?: string | null;
  /**
   * Remaining executions (null = unlimited)
   */
  remainingExecutions?: number | null;
  /**
   * Timezone for the schedule
   */
  timezone: string;
  /**
   * Total number of executions so far
   */
  totalExecutions: number;
}

export interface CronStats {
  /**
   * Number of active (enabled) jobs
   */
  activeJobs: number;
  /**
   * Total executions completed
   */
  completedExecutions: number;
  /**
   * Remaining executions across all jobs
   */
  pendingExecutions: number;
  /**
   * Total number of cron jobs
   */
  totalJobs: number;
}

// ==================== Context Types ====================

export interface CronJobSummaryForContext {
  cronPattern: string;
  description?: string | null;
  enabled: boolean;
  id: string;
  lastExecutedAt?: string | null;
  name?: string | null;
  remainingExecutions?: number | null;
  timezone: string;
  totalExecutions: number;
}
