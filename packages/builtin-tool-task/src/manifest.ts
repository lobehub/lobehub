import type { BuiltinToolManifest } from '@lobechat/types';

import { TASK_STATUSES, UNFINISHED_TASK_STATUSES } from './constants';
import { DEFAULT_LIST_TASK_LIMIT } from './listTasks';
import { systemPrompt } from './systemRole';
import { TaskApiName } from './types';

export const TaskIdentifier = 'lobe-task';

export const TaskManifest: BuiltinToolManifest = {
  api: [
    // ==================== Task CRUD ====================
    {
      description:
        'Create a new task. Optionally attach it as a subtask by specifying parentIdentifier.',
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
              'Identifier of the parent task (e.g. "TASK-1"). If provided, the new task becomes a subtask.',
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
        },
        required: ['name', 'instruction'],
        type: 'object',
      },
    },
    {
      description:
        'List tasks. Without any filters, returns top-level unfinished tasks of the current agent. If you provide any filter, omitted filters are not applied implicitly.',
      name: TaskApiName.listTasks,
      parameters: {
        properties: {
          assigneeAgentId: {
            description:
              'Restrict to tasks assigned to this agent. When omitted, no assignee filter is applied unless listTasks is called without any filters, which defaults to the current agent.',
            type: 'string',
          },
          limit: { description: `Max 1-100. Default ${DEFAULT_LIST_TASK_LIMIT}.`, type: 'number' },
          offset: { description: 'Pagination offset.', type: 'number' },
          parentIdentifier: {
            description:
              'List subtasks of this parent (e.g. "TASK-1"). When omitted, no parent filter is applied unless listTasks is called without any filters, which defaults to top-level tasks.',
            type: 'string',
          },
          priorities: {
            description: 'Filter by priority values. 0=none, 1=urgent, 2=high, 3=normal, 4=low.',
            items: { enum: [0, 1, 2, 3, 4], type: 'number' },
            type: 'array',
          },
          statuses: {
            description: `Filter by statuses. When omitted, no status filter is applied unless listTasks is called without any filters, which defaults to [${UNFINISHED_TASK_STATUSES.map((s) => `"${s}"`).join(', ')}].`,
            items: {
              enum: [...TASK_STATUSES],
              type: 'string',
            },
            type: 'array',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'View details of a specific task. If identifier is omitted, this only works when there is a current task context.',
      name: TaskApiName.viewTask,
      parameters: {
        properties: {
          identifier: {
            description:
              'The task identifier to view (e.g. "TASK-1"). If omitted, the current task is used only when a current task context exists.',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        "Edit a task's fields (name, description, instruction, priority) or dependencies (batched). Status changes go through updateTaskStatus.",
      name: TaskApiName.editTask,
      parameters: {
        properties: {
          addDependencies: {
            description:
              'Identifiers of tasks this task should block on (e.g. ["TASK-2", "TASK-3"]).',
            items: { type: 'string' },
            type: 'array',
          },
          description: {
            description:
              'Human-readable description (displayed in UI). Separate from instruction, which guides the agent.',
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
          removeDependencies: {
            description: 'Identifiers of existing dependencies to remove.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['identifier'],
        type: 'object',
      },
    },
    {
      description:
        "Update a task's status. Use to mark tasks as completed, canceled, paused, resumed, or failed. If identifier is omitted, this only works when there is a current task context.",
      name: TaskApiName.updateTaskStatus,
      parameters: {
        properties: {
          error: {
            description: 'Failure reason to store on the task. Only valid when status is "failed".',
            type: 'string',
          },
          identifier: {
            description:
              'The task identifier (e.g. "TASK-1"). If omitted, the current task is used only when a current task context exists.',
            type: 'string',
          },
          status: {
            description:
              'New status for the task. Use error only when setting the status to failed.',
            enum: [...TASK_STATUSES],
            type: 'string',
          },
        },
        required: ['status'],
        type: 'object',
      },
    },
    {
      description:
        'Permanently delete a task by identifier. Subtasks are NOT cascaded — they become top-level tasks after deletion. Dependencies, topics, pinned documents, comments, and briefs attached to the task are cascade-deleted. This action is irreversible.',
      name: TaskApiName.deleteTask,
      parameters: {
        properties: {
          identifier: {
            description: 'The identifier of the task to delete (e.g. "TASK-1").',
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
    description: 'Create, list, edit, delete tasks with dependencies',
    title: 'Task Tools',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
