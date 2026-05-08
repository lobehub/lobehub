import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { mutate } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

import { CronIdentifier } from '../manifest';
import {
  type CreateCronJobParams,
  CronApiName,
  type CronJobSummary,
  type DeleteCronJobParams,
  type GetCronJobParams,
  type ListCronJobsParams,
  type ResetExecutionsParams,
  type ToggleCronJobParams,
  type UpdateCronJobParams,
} from '../types';

const FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY = 'cronTopicsWithJobInfo';

const log = debug('lobe-cron:executor');

class CronExecutor extends BaseExecutor<typeof CronApiName> {
  readonly identifier = CronIdentifier;
  protected readonly apiEnum = CronApiName;

  /**
   * Create a new scheduled task
   */
  createCronJob = async (
    params: CreateCronJobParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const agentId = ctx?.agentId;
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

      log('[CronExecutor] createCronJob - params:', params, 'agentId:', agentId);

      const result = await lambdaClient.agentCronJob.create.mutate({
        agentId,
        content: params.content,
        cronPattern: params.cronPattern,
        description: params.description,
        enabled: params.enabled ?? true,
        maxExecutions: params.maxExecutions,
        name: params.name,
        timezone: params.timezone || 'UTC',
      });

      const cronJob = result.data as CronJobSummary;

      // Refresh the cron jobs list in sidebar
      await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, agentId]);

      return {
        content: `Scheduled task "${params.name}" created successfully. It will run according to the pattern "${params.cronPattern}" in timezone ${params.timezone || 'UTC'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CronExecutor] createCronJob - error:', error);
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
  };

  /**
   * List all scheduled tasks for the current agent
   */
  listCronJobs = async (
    params: ListCronJobsParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const agentId = ctx?.agentId;
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

      log('[CronExecutor] listCronJobs - agentId:', agentId, 'params:', params);

      const result = await lambdaClient.agentCronJob.list.query({
        agentId,
        enabled: params.enabled,
        limit: params.limit || 20,
        offset: params.offset || 0,
      });

      const cronJobs = (result.data || []) as CronJobSummary[];
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

      // Format the list for display
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
      log('[CronExecutor] listCronJobs - error:', error);
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
  };

  /**
   * Get details of a specific scheduled task
   */
  getCronJob = async (
    params: GetCronJobParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CronExecutor] getCronJob - id:', params.id);

      const result = await lambdaClient.agentCronJob.findById.query({ id: params.id });
      const cronJob = result.data as CronJobSummary;

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
      log('[CronExecutor] getCronJob - error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${params.id}`
          : `Failed to get scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'GetCronJobFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Update an existing scheduled task
   */
  updateCronJob = async (
    params: UpdateCronJobParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CronExecutor] updateCronJob - id:', params.id, 'params:', params);

      const { id, ...updateData } = params;
      const result = await lambdaClient.agentCronJob.update.mutate({
        data: updateData,
        id,
      });

      const cronJob = result.data as CronJobSummary;

      // Build a summary of what was updated
      const updates: string[] = [];
      if (params.name) updates.push(`name: "${params.name}"`);
      if (params.content) updates.push('content updated');
      if (params.cronPattern) updates.push(`schedule: ${params.cronPattern}`);
      if (params.timezone) updates.push(`timezone: ${params.timezone}`);
      if (params.enabled !== undefined) updates.push(params.enabled ? 'enabled' : 'disabled');
      if (params.maxExecutions !== undefined) {
        updates.push(
          params.maxExecutions ? `max executions: ${params.maxExecutions}` : 'unlimited executions',
        );
      }

      // Refresh the cron jobs list in sidebar
      await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, cronJob.agentId]);

      return {
        content: `Scheduled task "${cronJob.name || 'Unnamed'}" updated successfully. Changes: ${updates.join(', ') || 'no changes'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CronExecutor] updateCronJob - error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${params.id}`
          : `Failed to update scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'UpdateCronJobFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Delete a scheduled task
   */
  deleteCronJob = async (
    params: DeleteCronJobParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CronExecutor] deleteCronJob - id:', params.id);

      await lambdaClient.agentCronJob.delete.mutate({ id: params.id });

      // Refresh the cron jobs list in sidebar
      if (ctx?.agentId) {
        await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, ctx.agentId]);
      }

      return {
        content: `Scheduled task deleted successfully.`,
        state: {
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CronExecutor] deleteCronJob - error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${params.id}`
          : `Failed to delete scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'DeleteCronJobFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Enable or disable a scheduled task
   */
  toggleCronJob = async (
    params: ToggleCronJobParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CronExecutor] toggleCronJob - id:', params.id, 'enabled:', params.enabled);

      const result = await lambdaClient.agentCronJob.update.mutate({
        data: { enabled: params.enabled },
        id: params.id,
      });

      const cronJob = result.data as CronJobSummary;

      // Refresh the cron jobs list in sidebar
      await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, cronJob.agentId]);

      return {
        content: `Scheduled task "${cronJob.name || 'Unnamed'}" has been ${params.enabled ? 'enabled' : 'disabled'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CronExecutor] toggleCronJob - error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${params.id}`
          : `Failed to toggle scheduled task: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'ToggleCronJobFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Reset execution count for a scheduled task
   */
  resetExecutions = async (
    params: ResetExecutionsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log(
        '[CronExecutor] resetExecutions - id:',
        params.id,
        'newMaxExecutions:',
        params.newMaxExecutions,
      );

      const result = await lambdaClient.agentCronJob.resetExecutions.mutate({
        id: params.id,
        newMaxExecutions: params.newMaxExecutions,
      });

      const cronJob = result.data as CronJobSummary;

      // Refresh the cron jobs list in sidebar
      await mutate([FETCH_CRON_TOPICS_WITH_JOB_INFO_KEY, cronJob.agentId]);

      return {
        content: `Execution count for "${cronJob.name || 'Unnamed'}" has been reset. ${cronJob.maxExecutions ? `New limit: ${cronJob.maxExecutions} executions` : 'Unlimited executions'}.`,
        state: {
          cronJob,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CronExecutor] resetExecutions - error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Scheduled task not found: ${params.id}`
          : `Failed to reset executions: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CronJobNotFound' : 'ResetExecutionsFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Get execution statistics
   */
  getStats = async (
    _params: Record<string, never>,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CronExecutor] getStats');

      const result = await lambdaClient.agentCronJob.getStats.query();
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
      log('[CronExecutor] getStats - error:', error);
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
  };
}

export const cronExecutor = new CronExecutor();
