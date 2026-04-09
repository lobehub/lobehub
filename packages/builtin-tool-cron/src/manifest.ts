import type { BuiltinToolManifest } from '@lobechat/types';
import type { JSONSchema7 } from 'json-schema';

import { systemPrompt } from './systemRole';
import { CronApiName } from './types';

export const CronIdentifier = 'lobe-cron';

export const CronManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Create a new scheduled task for the current agent. The task will run automatically at the specified schedule. Minimum interval is 30 minutes.',
      name: CronApiName.createCronJob,
      parameters: {
        additionalProperties: false,
        properties: {
          content: {
            description:
              'The prompt/instructions that will be sent to the agent when the task runs. This is the main content of the scheduled task.',
            type: 'string',
          },
          cronPattern: {
            description:
              'Standard cron pattern defining when the task runs. Format: "minute hour day month weekday". Examples: "0 9 * * *" (9 AM daily), "30 */2 * * *" (every 2 hours at :30), "0 14 * * 1-5" (2 PM weekdays). Minimum interval is 30 minutes.',
            type: 'string',
          },
          description: {
            description: 'Optional description explaining what this scheduled task does',
            type: 'string',
          },
          enabled: {
            default: true,
            description: 'Whether the task should be enabled immediately (default: true)',
            type: 'boolean',
          },
          maxExecutions: {
            description:
              'Maximum number of times this task will run. Leave empty or null for unlimited executions.',
            type: ['integer', 'null'],
          },
          name: {
            description:
              'Human-readable name for the scheduled task (e.g., "Daily Report", "Weekly Summary")',
            type: 'string',
          },
          timezone: {
            default: 'UTC',
            description:
              'Timezone for the schedule (e.g., "America/New_York", "Asia/Shanghai", "Europe/London"). Default is UTC.',
            type: 'string',
          },
        },
        required: ['name', 'content', 'cronPattern'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'List all scheduled tasks for the current agent. Returns task names, schedules, status, and execution counts.',
      name: CronApiName.listCronJobs,
      parameters: {
        additionalProperties: false,
        properties: {
          enabled: {
            description: 'Filter by enabled/disabled status. Leave empty to show all tasks.',
            type: 'boolean',
          },
          limit: {
            default: 20,
            description: 'Maximum number of results to return (default: 20, max: 100)',
            maximum: 100,
            minimum: 1,
            type: 'integer',
          },
          offset: {
            default: 0,
            description: 'Number of results to skip for pagination',
            minimum: 0,
            type: 'integer',
          },
        },
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description: 'Get detailed information about a specific scheduled task by its ID.',
      name: CronApiName.getCronJob,
      parameters: {
        additionalProperties: false,
        properties: {
          id: {
            description: 'The unique ID of the scheduled task to retrieve',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Update an existing scheduled task. You can modify the name, content, schedule, timezone, or execution limits.',
      name: CronApiName.updateCronJob,
      parameters: {
        additionalProperties: false,
        properties: {
          content: {
            description: 'New prompt/instructions for the task',
            type: 'string',
          },
          cronPattern: {
            description: 'New cron pattern for the schedule',
            type: 'string',
          },
          description: {
            description: 'New description for the task',
            type: 'string',
          },
          enabled: {
            description: 'Enable or disable the task',
            type: 'boolean',
          },
          id: {
            description: 'The ID of the scheduled task to update',
            type: 'string',
          },
          maxExecutions: {
            description: 'New maximum number of executions (null for unlimited)',
            type: ['integer', 'null'],
          },
          name: {
            description: 'New name for the task',
            type: 'string',
          },
          timezone: {
            description: 'New timezone for the schedule',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Delete a scheduled task permanently. This action cannot be undone. The task will stop running and all execution history will be removed.',
      name: CronApiName.deleteCronJob,
      parameters: {
        additionalProperties: false,
        properties: {
          id: {
            description: 'The ID of the scheduled task to delete',
            type: 'string',
          },
        },
        required: ['id'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Enable or disable a scheduled task. Disabled tasks will not run but their configuration is preserved.',
      name: CronApiName.toggleCronJob,
      parameters: {
        additionalProperties: false,
        properties: {
          enabled: {
            description: 'Set to true to enable the task, false to disable it',
            type: 'boolean',
          },
          id: {
            description: 'The ID of the scheduled task to toggle',
            type: 'string',
          },
        },
        required: ['id', 'enabled'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Reset the execution count for a scheduled task and re-enable it. Useful when a task has reached its maximum executions or you want to restart the count.',
      name: CronApiName.resetExecutions,
      parameters: {
        additionalProperties: false,
        properties: {
          id: {
            description: 'The ID of the scheduled task to reset',
            type: 'string',
          },
          newMaxExecutions: {
            description:
              'Optional new maximum executions value. If not specified, keeps the current max value.',
            minimum: 1,
            type: 'integer',
          },
        },
        required: ['id'],
        type: 'object',
      } satisfies JSONSchema7,
    },
    {
      description:
        'Get execution statistics for all scheduled tasks owned by the user. Shows active jobs, completed executions, and pending executions.',
      name: CronApiName.getStats,
      parameters: {
        additionalProperties: false,
        properties: {},
        type: 'object',
      } satisfies JSONSchema7,
    },
  ],
  identifier: CronIdentifier,
  meta: {
    avatar: '⏰',
    description:
      'Manage scheduled tasks that run automatically at specified times. Create, update, enable/disable, and monitor recurring tasks for your agents.',
    title: 'Scheduled Tasks',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
