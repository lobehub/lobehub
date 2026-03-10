import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DeleteScheduledTaskParams,
  GetScheduledTaskParams,
  ListedScheduledTask,
  ListScheduledTasksParams,
  ScheduledTaskDetail,
  SetScheduledTaskParams,
} from '../types';

export interface SetScheduledTaskResult {
  action: 'created' | 'updated';
  agentId: string;
  cronPattern: string;
  enabled: boolean;
  jobId: string;
  maxExecutions?: number | null;
  timezone: string;
  updatedFields?: string[];
}

export interface DeleteScheduledTaskResult {
  jobId: string;
}

export interface GetScheduledTaskResult extends ScheduledTaskDetail {}

export interface ListScheduledTasksResult {
  items: ListedScheduledTask[];
  limit: number;
  offset: number;
  total: number;
}

export interface ScheduledTaskRuntimeService {
  deleteScheduledTask: (params: DeleteScheduledTaskParams) => Promise<DeleteScheduledTaskResult>;
  getScheduledTask: (params: GetScheduledTaskParams) => Promise<GetScheduledTaskResult>;
  listScheduledTasks: (params: ListScheduledTasksParams) => Promise<ListScheduledTasksResult>;
  setScheduledTask: (
    params: SetScheduledTaskParams & { agentId?: string },
  ) => Promise<SetScheduledTaskResult>;
}

export interface ScheduledTaskExecutionRuntimeOptions {
  service: ScheduledTaskRuntimeService;
}

const formatMaxExecutionsLabel = (maxExecutions?: number | null) =>
  maxExecutions === null || maxExecutions === undefined ? 'unlimited' : String(maxExecutions);

const normalizeMaxExecutions = (rawValue: unknown): { error?: string; value?: number | null } => {
  if (rawValue === undefined) return { value: undefined };
  if (rawValue === null) return { value: null };

  if (typeof rawValue === 'string' && rawValue.trim().toLowerCase() === 'null') {
    return { value: null };
  }

  const value =
    typeof rawValue === 'string' && /^\d+$/.test(rawValue.trim())
      ? Number(rawValue.trim())
      : rawValue;

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10_000) {
    return {
      error: 'maxExecutions must be an integer between 1 and 10000, or null.',
    };
  }

  return { value };
};

export class ScheduledTaskExecutionRuntime {
  private service: ScheduledTaskRuntimeService;

  constructor(options: ScheduledTaskExecutionRuntimeOptions) {
    this.service = options.service;
  }

  async setScheduledTask(
    args: SetScheduledTaskParams,
    context?: { agentId?: string },
  ): Promise<BuiltinServerRuntimeOutput> {
    const jobId = args.jobId?.trim();
    const taskName = args.name?.trim();
    const taskContent = args.content?.trim();
    const taskCronPattern = args.cronPattern?.trim();
    const taskDescription = args.description?.trim();
    const taskTimezone = args.timezone?.trim();

    const { error: maxExecutionsError, value: normalizedMaxExecutions } = normalizeMaxExecutions(
      args.maxExecutions as unknown,
    );

    if (maxExecutionsError) {
      return {
        content: `Cannot set scheduled task: ${maxExecutionsError}`,
        success: false,
      };
    }

    if (!jobId) {
      const agentId = args.agentId || context?.agentId;

      if (!agentId) {
        return {
          content: 'Cannot set scheduled task: no target agent context found for create path.',
          success: false,
        };
      }

      if (!taskName || !taskContent || !taskCronPattern) {
        return {
          content:
            'Cannot set scheduled task: name, content, and cronPattern are required when creating.',
          success: false,
        };
      }

      try {
        const result = await this.service.setScheduledTask({
          agentId,
          content: taskContent,
          cronPattern: taskCronPattern,
          description: taskDescription,
          enabled: args.enabled ?? true,
          maxExecutions: normalizedMaxExecutions ?? null,
          name: taskName,
          timezone: taskTimezone || 'UTC',
        });

        return {
          content: `Scheduled task created successfully.\n- jobId: ${result.jobId}\n- cron: ${result.cronPattern}\n- timezone: ${result.timezone}\n- enabled: ${result.enabled}\n- maxExecutions: ${formatMaxExecutionsLabel(result.maxExecutions)}`,
          state: result,
          success: true,
        };
      } catch (e) {
        return {
          content: `Failed to set scheduled task: ${(e as Error).message}`,
          success: false,
        };
      }
    }

    const updatedFields = [
      args.content !== undefined ? 'content' : null,
      args.cronPattern !== undefined ? 'cronPattern' : null,
      args.description !== undefined ? 'description' : null,
      args.enabled !== undefined ? 'enabled' : null,
      args.maxExecutions !== undefined ? 'maxExecutions' : null,
      args.name !== undefined ? 'name' : null,
      args.timezone !== undefined ? 'timezone' : null,
    ].filter((field): field is string => !!field);

    if (updatedFields.length === 0) {
      return {
        content: 'No updates provided. Please include at least one mutable field.',
        success: false,
      };
    }

    try {
      const result = await this.service.setScheduledTask({
        content: args.content !== undefined ? taskContent : undefined,
        cronPattern: args.cronPattern !== undefined ? taskCronPattern : undefined,
        description: args.description !== undefined ? taskDescription : undefined,
        enabled: args.enabled,
        jobId,
        maxExecutions: args.maxExecutions !== undefined ? normalizedMaxExecutions : undefined,
        name: args.name !== undefined ? taskName : undefined,
        timezone: args.timezone !== undefined ? taskTimezone : undefined,
      });

      return {
        content: `Scheduled task updated successfully.\n- jobId: ${result.jobId}\n- cron: ${result.cronPattern}\n- timezone: ${result.timezone}\n- enabled: ${result.enabled}\n- maxExecutions: ${formatMaxExecutionsLabel(result.maxExecutions)}`,
        state: {
          ...result,
          updatedFields,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to set scheduled task: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listScheduledTasks(
    args: ListScheduledTasksParams,
    context?: { agentId?: string },
  ): Promise<BuiltinServerRuntimeOutput> {
    const listParams: ListScheduledTasksParams = {
      ...args,
      agentId: args.agentId || context?.agentId,
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
    };

    try {
      const result = await this.service.listScheduledTasks(listParams);

      if (result.items.length === 0) {
        return {
          content: listParams.agentId
            ? `No scheduled tasks found for agent ${listParams.agentId}.`
            : 'No scheduled tasks found.',
          state: result,
          success: true,
        };
      }

      const tasksText = result.items
        .map(
          (item, index) =>
            `${index + 1}. ${item.name || '(unnamed task)'}\n   - jobId: ${item.jobId}\n   - agentId: ${item.agentId}\n   - cron: ${item.cronPattern}\n   - timezone: ${item.timezone}\n   - enabled: ${item.enabled}\n   - maxExecutions: ${formatMaxExecutionsLabel(item.maxExecutions)}\n   - remainingExecutions: ${formatMaxExecutionsLabel(item.remainingExecutions)}\n   - totalExecutions: ${item.totalExecutions ?? 0}`,
        )
        .join('\n\n');

      return {
        content: `Found ${result.total} scheduled task(s) (offset ${result.offset}, limit ${result.limit}):\n\n${tasksText}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to list scheduled tasks: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async getScheduledTask(args: GetScheduledTaskParams): Promise<BuiltinServerRuntimeOutput> {
    const jobId = args.jobId?.trim();

    if (!jobId) {
      return {
        content: 'Cannot get scheduled task: jobId is required and cannot be empty.',
        success: false,
      };
    }

    try {
      const result = await this.service.getScheduledTask({ jobId });

      return {
        content: `Scheduled task details:\n- jobId: ${result.jobId}\n- name: ${result.name || '(unnamed task)'}\n- agentId: ${result.agentId}\n- cron: ${result.cronPattern}\n- timezone: ${result.timezone}\n- enabled: ${result.enabled}\n- maxExecutions: ${formatMaxExecutionsLabel(result.maxExecutions)}\n- remainingExecutions: ${formatMaxExecutionsLabel(result.remainingExecutions)}\n- totalExecutions: ${result.totalExecutions ?? 0}\n- lastExecutedAt: ${result.lastExecutedAt || 'never'}`,
        state: result,
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to get scheduled task: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async deleteScheduledTask(args: DeleteScheduledTaskParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.service.deleteScheduledTask(args);

      return {
        content: `Scheduled task deleted successfully.\n- jobId: ${result.jobId}`,
        state: {
          deleted: true,
          jobId: result.jobId,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to delete scheduled task: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
