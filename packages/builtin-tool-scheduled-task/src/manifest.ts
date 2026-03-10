import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ScheduledTaskApiName, ScheduledTaskIdentifier } from './types';

export const ScheduledTaskManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Set a scheduled task. If jobId is provided, update that task; otherwise create a new one.',
      humanIntervention: 'required',
      name: ScheduledTaskApiName.setScheduledTask,
      parameters: {
        properties: {
          agentId: {
            description:
              'Optional target agent ID. Used for create path if current conversation agent is unavailable.',
            type: 'string',
          },
          content: {
            description:
              'Task content. Required for create path. On update path, only include when you need to change content.',
            type: 'string',
          },
          cronPattern: {
            description:
              'Cron pattern (e.g., "30 * * * *"). Required for create path. On update path, include only when changing schedule.',
            type: 'string',
          },
          description: {
            description: 'Optional task description.',
            type: 'string',
          },
          enabled: {
            default: true,
            description: 'Whether to enable this task.',
            type: 'boolean',
          },
          jobId: {
            description:
              'Optional existing job ID. If provided, performs update; if omitted, performs create.',
            type: 'string',
          },
          name: {
            description:
              'Task name. Required for create path. On update path, include only when changing name.',
            type: 'string',
          },
          maxExecutions: {
            description:
              'Optional maximum execution count. Use a positive number to limit executions; use null (or omit) for unlimited executions.',
            oneOf: [{ maximum: 10_000, minimum: 1, type: 'number' }, { type: 'null' }],
          },
          timezone: {
            description: 'Optional timezone (e.g., "Asia/Shanghai"). Default create timezone: UTC.',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      description: 'Delete an existing agent scheduled task by job ID.',
      humanIntervention: 'required',
      name: ScheduledTaskApiName.deleteScheduledTask,
      parameters: {
        properties: {
          jobId: {
            description: 'The scheduled task job ID to delete.',
            type: 'string',
          },
        },
        required: ['jobId'],
        type: 'object',
      },
    },
    {
      description:
        'Get a single scheduled task by job ID. Use this to confirm exact current fields before update/delete.',
      name: ScheduledTaskApiName.getScheduledTask,
      parameters: {
        properties: {
          jobId: {
            description: 'The scheduled task job ID to retrieve.',
            type: 'string',
          },
        },
        required: ['jobId'],
        type: 'object',
      },
    },
    {
      description:
        'List current scheduled tasks so the agent can resolve job IDs before update/delete operations.',
      name: ScheduledTaskApiName.listScheduledTasks,
      parameters: {
        properties: {
          agentId: {
            description:
              'Optional target agent ID. If omitted, the current conversation agent is preferred.',
            type: 'string',
          },
          enabled: {
            description: 'Optional enabled status filter.',
            type: 'boolean',
          },
          limit: {
            description: 'Maximum number of items to return. Default: 20.',
            type: 'number',
          },
          offset: {
            description: 'Pagination offset. Default: 0.',
            type: 'number',
          },
        },
        type: 'object',
      },
    },
  ],
  identifier: ScheduledTaskIdentifier,
  meta: {
    avatar: '⏰',
    description: 'Manage agent scheduled tasks with set/get/list/delete operations',
    title: 'Scheduled Tasks',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
