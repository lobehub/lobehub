import {
  CronExecutionRuntime,
  CronIdentifier,
  type CronJobSummary,
  type CronStats,
  type ICronService,
} from '@lobechat/builtin-tool-cron';
import debug from 'debug';

import { AgentCronJobModel } from '@/database/models/agentCronJob';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:cron-runtime');

/**
 * Server-side Cron Service implementation
 * Wraps AgentCronJobModel to provide ICronService interface
 */
class ServerCronService implements ICronService {
  private cronJobModel: AgentCronJobModel;

  constructor(cronJobModel: AgentCronJobModel) {
    this.cronJobModel = cronJobModel;
  }

  async create(data: {
    agentId: string;
    content: string;
    cronPattern: string;
    description?: string;
    enabled?: boolean;
    maxExecutions?: number | null;
    name: string;
    timezone?: string;
  }): Promise<{ data: CronJobSummary }> {
    log('create: agentId=%s, name=%s', data.agentId, data.name);

    const cronJob = await this.cronJobModel.create({
      agentId: data.agentId,
      content: data.content,
      cronPattern: data.cronPattern,
      description: data.description,
      enabled: data.enabled ?? true,
      maxExecutions: data.maxExecutions,
      name: data.name,
      timezone: data.timezone || 'UTC',
    });

    log('create success: id=%s', cronJob.id);

    return { data: cronJob as CronJobSummary };
  }

  async delete(id: string): Promise<{ success: boolean }> {
    log('delete: id=%s', id);

    const deleted = await this.cronJobModel.delete(id);

    log('delete result: %s', deleted ? 'success' : 'not found');

    return { success: !!deleted };
  }

  async findById(id: string): Promise<{ data: CronJobSummary }> {
    log('findById: id=%s', id);

    const cronJob = await this.cronJobModel.findById(id);

    if (!cronJob) {
      throw new Error(`Cron job not found: ${id}`);
    }

    log('findById success: id=%s', cronJob.id);

    return { data: cronJob as CronJobSummary };
  }

  async getStats(): Promise<{ data: CronStats }> {
    log('getStats');

    const stats = await this.cronJobModel.getExecutionStats();

    log('getStats success: totalJobs=%d', stats.totalJobs);

    return { data: stats as CronStats };
  }

  async list(options: {
    agentId?: string;
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: CronJobSummary[];
    pagination?: {
      hasMore: boolean;
      limit: number;
      offset: number;
      total: number;
    };
  }> {
    log('list: agentId=%s, enabled=%s', options.agentId, options.enabled);

    const result = await this.cronJobModel.findWithPagination({
      agentId: options.agentId,
      enabled: options.enabled,
      limit: options.limit || 20,
      offset: options.offset || 0,
    });

    log('list success: %d jobs', result.jobs.length);

    return {
      data: result.jobs as CronJobSummary[],
      pagination: {
        hasMore: (options.offset || 0) + (options.limit || 20) < result.total,
        limit: options.limit || 20,
        offset: options.offset || 0,
        total: result.total,
      },
    };
  }

  async resetExecutions(id: string, newMaxExecutions?: number): Promise<{ data: CronJobSummary }> {
    log('resetExecutions: id=%s, newMaxExecutions=%s', id, newMaxExecutions);

    const cronJob = await this.cronJobModel.resetExecutions(id, newMaxExecutions);

    if (!cronJob) {
      throw new Error(`Cron job not found: ${id}`);
    }

    log('resetExecutions success: id=%s', cronJob.id);

    return { data: cronJob as CronJobSummary };
  }

  async update(
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
  ): Promise<{ data: CronJobSummary }> {
    log('update: id=%s', id);

    const cronJob = await this.cronJobModel.update(id, data);

    if (!cronJob) {
      throw new Error(`Cron job not found: ${id}`);
    }

    log('update success: id=%s', cronJob.id);

    return { data: cronJob as CronJobSummary };
  }
}

/**
 * Cron Server Runtime
 * Per-request runtime (needs userId, agentId, db)
 */
export const cronRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Cron execution');
    }

    if (!context.serverDB) {
      throw new Error('serverDB is required for Cron execution');
    }

    log('Creating CronExecutionRuntime for userId=%s, agentId=%s', context.userId, context.agentId);

    const cronJobModel = new AgentCronJobModel(context.serverDB, context.userId);
    const cronService = new ServerCronService(cronJobModel);

    return new CronExecutionRuntime(cronService, {
      agentId: context.agentId,
      userId: context.userId,
    });
  },
  identifier: CronIdentifier,
};
