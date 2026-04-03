import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  CreateCronJobParams,
  CronJobSummary,
  CronStats,
  DeleteCronJobParams,
  GetCronJobParams,
  ListCronJobsParams,
  ResetExecutionsParams,
  ToggleCronJobParams,
  UpdateCronJobParams,
} from '../types';

/**
 * Service interface for Cron Job operations
 * Abstracted to allow different implementations
 */
export interface ICronService {
  /**
   * Create a new cron job
   */
  create: (data: {
    agentId: string;
    content: string;
    cronPattern: string;
    description?: string;
    enabled?: boolean;
    maxExecutions?: number | null;
    name: string;
    timezone?: string;
  }) => Promise<{ data: CronJobSummary }>;

  /**
   * Delete a cron job
   */
  delete: (id: string) => Promise<{ success: boolean }>;

  /**
   * Get a cron job by ID
   */
  findById: (id: string) => Promise<{ data: CronJobSummary }>;

  /**
   * Get execution statistics
   */
  getStats: () => Promise<{ data: CronStats }>;

  /**
   * List cron jobs with filtering
   */
  list: (options: {
    agentId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }) => Promise<{
    data: CronJobSummary[];
    pagination?: {
      hasMore: boolean;
      limit: number;
      offset: number;
      total: number;
    };
  }>;

  /**
   * Reset execution counts
   */
  resetExecutions: (id: string, newMaxExecutions?: number) => Promise<{ data: CronJobSummary }>;

  /**
   * Update a cron job
   */
  update: (
    id: string,
    data: {
      content?: string;
      cronPattern?: string;
      description?: string;
      enabled?: boolean;
      maxExecutions?: number | null;
      name?: string;
      timezone?: string;
    },
  ) => Promise<{ data: CronJobSummary }>;
}

/**
 * Cron Execution Runtime (Server-side)
 *
 * This runtime executes cron job tools via the injected ICronService.
 * The service handles context (userId) internally.
 */
export class CronExecutionRuntime {
  private cronService: ICronService;
  private context: { agentId?: string; userId?: string };

  constructor(cronService: ICronService, context: { agentId?: string; userId?: string } = {}) {
    this.cronService = cronService;
    this.context = context;
  }

  /**
   * Create a new scheduled task
   */
  async createCronJob(args: CreateCronJobParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const agentId = this.context.agentId;
      if (!agentId) {
        return {
          content: 'Cannot create scheduled task: agentId is not available in the current context.',
          error: {
            message: 'agentId is required but not available',
            type: 'MissingAgentId',
          },
          success: false,
        };
      }

      const result = await this.cronService.create({
        agentId,
        content: args.content,
        cronPattern: args.cronPattern,
        description: args.description,
        enabled: args.enabled ?? true,
        maxExecutions: args.maxExecutions,
        name: args.name,
        timezone: args.timezone || 'UTC',
      });

      const cronJob = result.data;

      return {
        content: `Scheduled task "${args.name}" created successfully. It will run according to the pattern "${args.cronPattern}" in timezone ${args.timezone || 'UTC'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create scheduled task';

      return {
        content: `Failed to create scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: 'CreateCronJobFailed',
        },
        success: false,
      };
    }
  }

  /**
   * List all scheduled tasks
   */
  async listCronJobs(args: ListCronJobsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const agentId = this.context.agentId;
      if (!agentId) {
        return {
          content: 'Cannot list scheduled tasks: agentId is not available in the current context.',
          error: {
            message: 'agentId is required but not available',
            type: 'MissingAgentId',
          },
          success: false,
        };
      }

      const result = await this.cronService.list({
        agentId,
        enabled: args.enabled,
        limit: args.limit || 20,
        offset: args.offset || 0,
      });

      const cronJobs = result.data || [];
      const pagination = result.pagination;

      if (cronJobs.length === 0) {
        return {
          content: 'No scheduled tasks found for this agent.',
          state: {
            cronJobs: [],
            pagination,
            success: true,
          },
          success: true,
        };
      }

      const taskList = cronJobs
        .map((job) => {
          const status = job.enabled ? 'enabled' : 'disabled';
          const execInfo = job.maxExecutions
            ? `${job.remainingExecutions ?? 0}/${job.maxExecutions} remaining`
            : 'unlimited';
          return `- ${job.name || 'Unnamed'} (${job.id}): ${job.cronPattern} [${status}, ${execInfo}]`;
        })
        .join('\n');

      return {
        content: `Found ${cronJobs.length} scheduled task(s):\n${taskList}`,
        state: {
          cronJobs,
          pagination,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to list scheduled tasks';

      return {
        content: `Failed to list scheduled tasks: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: 'ListCronJobsFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Get details of a specific scheduled task
   */
  async getCronJob(args: GetCronJobParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.cronService.findById(args.id);
      const cronJob = result.data;

      const status = cronJob.enabled ? 'enabled' : 'disabled';
      const execInfo = cronJob.maxExecutions
        ? `${cronJob.remainingExecutions ?? 0}/${cronJob.maxExecutions} executions remaining`
        : 'unlimited executions';

      return {
        content: `Task "${cronJob.name || 'Unnamed'}" (${cronJob.id}):\n- Schedule: ${cronJob.cronPattern} (${cronJob.timezone})\n- Status: ${status}\n- Executions: ${cronJob.totalExecutions} completed, ${execInfo}\n- Last run: ${cronJob.lastExecutedAt || 'never'}`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${args.id}`
          : `Failed to get scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'GetCronJobFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Update an existing scheduled task
   */
  async updateCronJob(args: UpdateCronJobParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { id, ...updateData } = args;
      const result = await this.cronService.update(id, updateData);
      const cronJob = result.data;

      const updates: string[] = [];
      if (args.name) updates.push(`name: "${args.name}"`);
      if (args.content) updates.push('content updated');
      if (args.cronPattern) updates.push(`schedule: ${args.cronPattern}`);
      if (args.timezone) updates.push(`timezone: ${args.timezone}`);
      if (args.enabled !== undefined) updates.push(args.enabled ? 'enabled' : 'disabled');
      if (args.maxExecutions !== undefined) {
        updates.push(
          args.maxExecutions ? `max executions: ${args.maxExecutions}` : 'unlimited executions',
        );
      }

      return {
        content: `Scheduled task "${cronJob.name || 'Unnamed'}" updated successfully. Changes: ${updates.join(', ') || 'no changes'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${args.id}`
          : `Failed to update scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'UpdateCronJobFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Delete a scheduled task
   */
  async deleteCronJob(args: DeleteCronJobParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.cronService.delete(args.id);

      if (!result.success) {
        return {
          content: `Scheduled task not found: ${args.id}`,
          error: {
            message: `Cron job not found: ${args.id}`,
            type: 'CronJobNotFound',
          },
          success: false,
        };
      }

      return {
        content: `Scheduled task deleted successfully.`,
        state: {
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${args.id}`
          : `Failed to delete scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'DeleteCronJobFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Enable or disable a scheduled task
   */
  async toggleCronJob(args: ToggleCronJobParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.cronService.update(args.id, { enabled: args.enabled });
      const cronJob = result.data;

      return {
        content: `Scheduled task "${cronJob.name || 'Unnamed'}" has been ${args.enabled ? 'enabled' : 'disabled'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${args.id}`
          : `Failed to toggle scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'ToggleCronJobFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Reset execution count for a scheduled task
   */
  async resetExecutions(args: ResetExecutionsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.cronService.resetExecutions(args.id, args.newMaxExecutions);
      const cronJob = result.data;

      return {
        content: `Execution count for "${cronJob.name || 'Unnamed'}" has been reset. ${cronJob.maxExecutions ? `New limit: ${cronJob.maxExecutions} executions` : 'Unlimited executions'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${args.id}`
          : `Failed to reset executions: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'ResetExecutionsFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Get execution statistics
   */
  async getStats(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.cronService.getStats();
      const stats = result.data;

      return {
        content: `Scheduled Tasks Statistics:\n- Total jobs: ${stats.totalJobs}\n- Active (enabled): ${stats.activeJobs}\n- Completed executions: ${stats.completedExecutions}\n- Pending executions: ${stats.pendingExecutions}`,
        state: {
          stats,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get statistics';

      return {
        content: `Failed to get execution statistics: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: 'GetStatsFailed',
        },
        success: false,
      };
    }
  }
}
