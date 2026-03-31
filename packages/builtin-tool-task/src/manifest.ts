import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { TaskApiName } from './types';

export const TaskIdentifier = 'lobe-task';

export const TaskManifest: BuiltinToolManifest = {
  api: [
    // ==================== Task CRUD ====================
    {
      description:
        'Create a new task. Optionally attach it as a subtask by specifying parentIdentifier. Review config is inherited from parent task by default.',
      name: TaskApiName.createTask,
      parameters: {
        properties: {
          instruction: {
            description: 'Detailed instruction for what the task should accomplish.',
            type: 'string',
          },
          name: {
            description: 'A short, descriptive name for the task.',
            type: 'string',
          },
          parentIdentifier: {
            description:
              'Identifier of the parent task (e.g. "TASK-1"). If provided, the new task becomes a subtask. Defaults to the current task if omitted.',
            type: 'string',
          },
          priority: {
            description: 'Priority level: 0=none, 1=urgent, 2=high, 3=normal, 4=low. Default is 0.',
            type: 'number',
          },
          sortOrder: {
            description:
              'Sort order within parent task. Lower values appear first. Use to control display order (e.g. chapter 1=0, chapter 2=1, etc.).',
            type: 'number',
          },
          review: {
            description:
              'Review config. If omitted, inherits from parent task. Set to configure LLM-as-Judge auto-review.',
            properties: {
              autoRetry: {
                description: 'Auto-retry on failure. Default true.',
                type: 'boolean',
              },
              criteria: {
                description: 'Review criteria with name and threshold (0-100).',
                items: {
                  properties: {
                    name: { description: 'Criterion name, e.g. "内容准确性"', type: 'string' },
                    threshold: { description: 'Pass threshold (0-100)', type: 'number' },
                  },
                  required: ['name', 'threshold'],
                  type: 'object',
                },
                type: 'array',
              },
              enabled: { description: 'Enable review. Default false.', type: 'boolean' },
              maxIterations: {
                description: 'Max review iterations. Default 3.',
                type: 'number',
              },
            },
            type: 'object',
          },
        },
        required: ['name', 'instruction'],
        type: 'object',
      },
    },
    {
      description:
        'List tasks with optional filters. Without filters, lists subtasks of the current task.',
      name: TaskApiName.listTasks,
      parameters: {
        properties: {
          parentIdentifier: {
            description:
              'List subtasks of a specific parent task. Defaults to the current task if omitted.',
            type: 'string',
          },
          status: {
            description: 'Filter by status.',
            enum: ['backlog', 'running', 'paused', 'completed', 'failed', 'canceled'],
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'View details of a specific task. If no identifier is provided, returns the current task.',
      name: TaskApiName.viewTask,
      parameters: {
        properties: {
          identifier: {
            description:
              'The task identifier to view (e.g. "TASK-1"). Defaults to the current task if omitted.',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        "Edit a task's name, instruction, priority, or dependencies. Use addDependency/removeDependency to manage execution order.",
      name: TaskApiName.editTask,
      parameters: {
        properties: {
          addDependency: {
            description:
              'Add a dependency — this task will block until the specified task completes. Provide the identifier (e.g. "TASK-2").',
            type: 'string',
          },
          identifier: {
            description: 'The identifier of the task to edit.',
            type: 'string',
          },
          instruction: {
            description: 'Updated instruction for the task.',
            type: 'string',
          },
          name: {
            description: 'Updated name for the task.',
            type: 'string',
          },
          priority: {
            description: 'Updated priority level: 0=none, 1=urgent, 2=high, 3=normal, 4=low.',
            type: 'number',
          },
          removeDependency: {
            description: 'Remove a dependency. Provide the identifier of the dependency to remove.',
            type: 'string',
          },
          review: {
            description: 'Update review config.',
            properties: {
              autoRetry: { type: 'boolean' },
              criteria: {
                items: {
                  properties: {
                    name: { type: 'string' },
                    threshold: { type: 'number' },
                  },
                  required: ['name', 'threshold'],
                  type: 'object',
                },
                type: 'array',
              },
              enabled: { type: 'boolean' },
              maxIterations: { type: 'number' },
            },
            type: 'object',
          },
        },
        required: ['identifier'],
        type: 'object',
      },
    },
    {
      description:
        "Update a task's status. Use to mark tasks as completed, canceled, or change lifecycle state. Defaults to the current task if no identifier provided.",
      name: TaskApiName.updateTaskStatus,
      parameters: {
        properties: {
          identifier: {
            description:
              'The task identifier (e.g. "TASK-1"). Defaults to the current task if omitted.',
            type: 'string',
          },
          status: {
            description: 'New status for the task.',
            enum: ['backlog', 'running', 'paused', 'completed', 'failed', 'canceled'],
            type: 'string',
          },
        },
        required: ['status'],
        type: 'object',
      },
    },
    {
      description: 'Delete a task by identifier.',
      name: TaskApiName.deleteTask,
      parameters: {
        properties: {
          identifier: {
            description: 'The identifier of the task to delete.',
            type: 'string',
          },
        },
        required: ['identifier'],
        type: 'object',
      },
    },
  ],
  identifier: TaskIdentifier,
  meta: {
    avatar: '\uD83D\uDCCB',
    description: 'Create, list, edit, delete tasks with dependencies and review config',
    title: 'Task Tools',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
