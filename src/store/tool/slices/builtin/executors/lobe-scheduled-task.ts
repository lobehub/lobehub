/**
 * Lobe Scheduled Task Executor
 *
 * Creates and exports the ScheduledTaskExecutor instance for registration.
 * Handles scheduled task CRUD operations.
 */
import { ScheduledTaskExecutionRuntime } from '@lobechat/builtin-tool-scheduled-task/executionRuntime';
import { ScheduledTaskExecutor } from '@lobechat/builtin-tool-scheduled-task/executor';

import { type UpdateAgentCronJobData } from '@/database/schemas/agentCronJob';
import { mutate } from '@/libs/swr';
import { agentCronJobService } from '@/services/agentCronJob';

const runtime = new ScheduledTaskExecutionRuntime({
  service: {
    setScheduledTask: async ({
      agentId,
      content,
      cronPattern,
      description,
      enabled,
      jobId,
      maxExecutions,
      name,
      timezone,
    }) => {
      if (!jobId) {
        if (!agentId || !content || !cronPattern || !name) {
          throw new Error('Missing required fields for scheduled task create path');
        }

        const result = await agentCronJobService.create({
          agentId,
          content,
          cronPattern,
          description,
          enabled: enabled ?? true,
          maxExecutions: maxExecutions ?? null,
          name,
          timezone: timezone || 'UTC',
        });

        if (!result.success) {
          throw new Error(result.message || 'Failed to set scheduled task');
        }

        await mutate(['cronTopicsWithJobInfo', agentId]);

        return {
          action: 'created' as const,
          agentId,
          cronPattern: result.data.cronPattern,
          enabled: !!result.data.enabled,
          jobId: result.data.id,
          maxExecutions: result.data.maxExecutions,
          timezone: result.data.timezone || timezone || 'UTC',
        };
      }

      const updatePayload: UpdateAgentCronJobData = {};

      if (content !== undefined) updatePayload.content = content;
      if (cronPattern !== undefined) updatePayload.cronPattern = cronPattern;
      if (description !== undefined) updatePayload.description = description;
      if (enabled !== undefined) updatePayload.enabled = enabled;
      if (maxExecutions !== undefined) updatePayload.maxExecutions = maxExecutions;
      if (name !== undefined) updatePayload.name = name;
      if (timezone !== undefined) updatePayload.timezone = timezone;

      if (Object.keys(updatePayload).length === 0) {
        throw new Error('No updates provided');
      }

      const result = await agentCronJobService.update(jobId, updatePayload);

      if (!result.success) {
        throw new Error(result.message || 'Failed to set scheduled task');
      }

      await mutate(['cronTopicsWithJobInfo', result.data.agentId]);

      return {
        action: 'updated' as const,
        agentId: result.data.agentId,
        cronPattern: result.data.cronPattern,
        enabled: !!result.data.enabled,
        jobId: result.data.id,
        maxExecutions: result.data.maxExecutions,
        timezone: result.data.timezone || 'UTC',
      };
    },
    listScheduledTasks: async ({ agentId, enabled, limit, offset }) => {
      const result = await agentCronJobService.list({
        agentId,
        enabled,
        limit,
        offset,
      });

      if (!result.success) {
        throw new Error('Failed to list scheduled tasks');
      }

      return {
        items: result.data.map((item) => ({
          agentId: item.agentId,
          cronPattern: item.cronPattern,
          description: item.description,
          enabled: !!item.enabled,
          jobId: item.id,
          lastExecutedAt: item.lastExecutedAt
            ? item.lastExecutedAt instanceof Date
              ? item.lastExecutedAt.toISOString()
              : new Date(item.lastExecutedAt).toISOString()
            : null,
          maxExecutions: item.maxExecutions,
          name: item.name,
          remainingExecutions: item.remainingExecutions,
          timezone: item.timezone || 'UTC',
          totalExecutions: item.totalExecutions,
        })),
        limit: result.pagination?.limit ?? limit ?? 20,
        offset: result.pagination?.offset ?? offset ?? 0,
        total: result.pagination?.total ?? result.data.length,
      };
    },
    deleteScheduledTask: async ({ jobId }) => {
      const result = await agentCronJobService.delete(jobId);

      if (!result.success) {
        throw new Error(result.message || 'Failed to delete scheduled task');
      }

      await mutate((key) => Array.isArray(key) && key[0] === 'cronTopicsWithJobInfo');

      return { jobId };
    },
    getScheduledTask: async ({ jobId }) => {
      const result = await agentCronJobService.getById(jobId);

      if (!result.success) {
        throw new Error('Failed to get scheduled task');
      }

      const item = result.data;

      return {
        agentId: item.agentId,
        content: item.content,
        cronPattern: item.cronPattern,
        description: item.description,
        enabled: !!item.enabled,
        jobId: item.id,
        lastExecutedAt: item.lastExecutedAt
          ? item.lastExecutedAt instanceof Date
            ? item.lastExecutedAt.toISOString()
            : new Date(item.lastExecutedAt).toISOString()
          : null,
        maxExecutions: item.maxExecutions,
        name: item.name,
        remainingExecutions: item.remainingExecutions,
        timezone: item.timezone || 'UTC',
        totalExecutions: item.totalExecutions,
      };
    },
  },
});

export const scheduledTaskExecutor = new ScheduledTaskExecutor(runtime);
