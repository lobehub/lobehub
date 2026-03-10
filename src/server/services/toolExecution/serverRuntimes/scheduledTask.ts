import { ScheduledTaskIdentifier } from '@lobechat/builtin-tool-scheduled-task';
import {
  type DeleteScheduledTaskResult,
  type GetScheduledTaskResult,
  type ListScheduledTasksResult,
  ScheduledTaskExecutionRuntime,
  type ScheduledTaskRuntimeService,
  type SetScheduledTaskResult,
} from '@lobechat/builtin-tool-scheduled-task/executionRuntime';

import { AgentCronJobModel } from '@/database/models/agentCronJob';
import { type UpdateAgentCronJobData } from '@/database/schemas/agentCronJob';
import { type LobeChatDatabase } from '@/database/type';
import { validateCronPatternByDeployment } from '@/server/services/agentCronPolicy';

import { type ServerRuntimeRegistration } from './types';

class ScheduledTaskServerRuntimeService implements ScheduledTaskRuntimeService {
  private userId: string;
  private serverDB: LobeChatDatabase;

  constructor(options: { serverDB: LobeChatDatabase; userId: string }) {
    this.serverDB = options.serverDB;
    this.userId = options.userId;
  }

  setScheduledTask = async (params: {
    agentId?: string;
    content?: string;
    cronPattern?: string;
    description?: string;
    enabled?: boolean;
    jobId?: string;
    maxExecutions?: number | null;
    name?: string;
    timezone?: string;
  }): Promise<SetScheduledTaskResult> => {
    const model = new AgentCronJobModel(this.serverDB, this.userId);

    if (!params.jobId) {
      if (!params.agentId || !params.content || !params.cronPattern || !params.name) {
        throw new Error(
          'agentId, name, content, and cronPattern are required for setScheduledTask create path',
        );
      }

      const patternValidation = validateCronPatternByDeployment(params.cronPattern);
      if (!patternValidation.valid) {
        throw new Error(patternValidation.message);
      }

      const job = await model.create({
        agentId: params.agentId,
        content: params.content,
        cronPattern: params.cronPattern,
        description: params.description,
        enabled: params.enabled ?? true,
        maxExecutions: params.maxExecutions ?? null,
        name: params.name,
        timezone: params.timezone || 'UTC',
      });

      return {
        action: 'created',
        agentId: job.agentId,
        cronPattern: job.cronPattern,
        enabled: !!job.enabled,
        jobId: job.id,
        maxExecutions: job.maxExecutions,
        timezone: job.timezone || 'UTC',
      };
    }

    if (params.cronPattern) {
      const patternValidation = validateCronPatternByDeployment(params.cronPattern);
      if (!patternValidation.valid) {
        throw new Error(patternValidation.message);
      }
    }

    const updatePayload: UpdateAgentCronJobData = {};

    if (params.content !== undefined) updatePayload.content = params.content;
    if (params.cronPattern !== undefined) updatePayload.cronPattern = params.cronPattern;
    if (params.description !== undefined) updatePayload.description = params.description;
    if (params.enabled !== undefined) updatePayload.enabled = params.enabled;
    if (params.maxExecutions !== undefined) updatePayload.maxExecutions = params.maxExecutions;
    if (params.name !== undefined) updatePayload.name = params.name;
    if (params.timezone !== undefined) updatePayload.timezone = params.timezone;

    const updated = await model.update(params.jobId, updatePayload);

    if (!updated) {
      throw new Error('Scheduled task not found or access denied');
    }

    return {
      action: 'updated',
      agentId: updated.agentId,
      cronPattern: updated.cronPattern,
      enabled: !!updated.enabled,
      jobId: updated.id,
      maxExecutions: updated.maxExecutions,
      timezone: updated.timezone || 'UTC',
    };
  };

  deleteScheduledTask = async (params: { jobId: string }): Promise<DeleteScheduledTaskResult> => {
    const model = new AgentCronJobModel(this.serverDB, this.userId);
    const deleted = await model.delete(params.jobId);

    if (!deleted) {
      throw new Error('Scheduled task not found or access denied');
    }

    return { jobId: params.jobId };
  };

  getScheduledTask = async (params: { jobId: string }): Promise<GetScheduledTaskResult> => {
    const model = new AgentCronJobModel(this.serverDB, this.userId);
    const job = await model.findById(params.jobId);

    if (!job) {
      throw new Error('Scheduled task not found or access denied');
    }

    return {
      agentId: job.agentId,
      content: job.content,
      cronPattern: job.cronPattern,
      description: job.description,
      enabled: !!job.enabled,
      jobId: job.id,
      lastExecutedAt: job.lastExecutedAt ? job.lastExecutedAt.toISOString() : null,
      maxExecutions: job.maxExecutions,
      name: job.name,
      remainingExecutions: job.remainingExecutions,
      timezone: job.timezone || 'UTC',
      totalExecutions: job.totalExecutions,
    };
  };

  listScheduledTasks = async (params: {
    agentId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ListScheduledTasksResult> => {
    const model = new AgentCronJobModel(this.serverDB, this.userId);
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    const result = await model.findWithPagination({
      agentId: params.agentId,
      enabled: params.enabled,
      limit,
      offset,
    });

    return {
      items: result.jobs.map((job) => ({
        agentId: job.agentId,
        cronPattern: job.cronPattern,
        description: job.description,
        enabled: !!job.enabled,
        jobId: job.id,
        lastExecutedAt: job.lastExecutedAt ? job.lastExecutedAt.toISOString() : null,
        maxExecutions: job.maxExecutions,
        name: job.name,
        remainingExecutions: job.remainingExecutions,
        timezone: job.timezone || 'UTC',
        totalExecutions: job.totalExecutions,
      })),
      limit,
      offset,
      total: result.total,
    };
  };
}

/**
 * Scheduled Task Server Runtime
 * Per-request runtime (needs serverDB, userId)
 */
export const scheduledTaskRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Scheduled Task execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Scheduled Task execution');
    }

    const service = new ScheduledTaskServerRuntimeService({
      serverDB: context.serverDB,
      userId: context.userId,
    });

    return new ScheduledTaskExecutionRuntime({ service });
  },
  identifier: ScheduledTaskIdentifier,
};
