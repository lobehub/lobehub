import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { GTDApiName } from './types';

export const GTDIdentifier = 'lobe-gtd';

export const GTDManifest: BuiltinToolManifest = {
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  api: [
    // ==================== Planning ====================
    {
      description:
        'Create a high-level plan document. Plans define the strategic direction (the "what" and "why"), while todos handle the actionable steps.',
      name: GTDApiName.createPlan,
      humanIntervention: 'always',
      renderDisplayControl: 'alwaysExpand',
      parameters: {
        properties: {
          goal: {
            description: 'The main goal or objective to achieve (used as document title).',
            type: 'string',
          },
          description: {
            description: 'A brief summary of the plan (1-2 sentences).',
            type: 'string',
          },
          context: {
            description:
              'Detailed context, constraints, background information, or strategic considerations relevant to the goal.',
            type: 'string',
          },
        },
        required: ['goal', 'description', 'context'],
        type: 'object',
      },
    },
    {
      description:
        'Update an existing plan document. Only use this when the goal fundamentally changes. Plans should remain stable once created - do not update plans just because details change.',
      name: GTDApiName.updatePlan,
      parameters: {
        properties: {
          planId: {
            description:
              'The document ID of the plan to update (e.g., "docs_xxx"). This ID is returned in the createPlan response. Do NOT use the goal text as planId.',
            type: 'string',
          },
          goal: {
            description: 'Updated goal (document title).',
            type: 'string',
          },
          description: {
            description: 'Updated brief summary.',
            type: 'string',
          },
          context: {
            description: 'Updated detailed context.',
            type: 'string',
          },
        },
        required: ['planId'],
        type: 'object',
      },
    },

    // ==================== Quick Todo ====================
    {
      description: 'Create new todo items. Pass an array of text strings.',
      name: GTDApiName.createTodos,
      humanIntervention: 'required',
      parameters: {
        properties: {
          adds: {
            description: 'Array of todo item texts to create.',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['items'],
        type: 'object',
      },
    },
    {
      description:
        'Update todo items with batch operations. Each operation specifies a type (add, update, remove, complete) and the relevant data.',
      name: GTDApiName.updateTodos,
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          operations: {
            description: 'Array of update operations to apply.',
            items: {
              properties: {
                type: {
                  description: 'Operation type: add, update, remove, or complete.',
                  enum: ['add', 'update', 'remove', 'complete'],
                  type: 'string',
                },
                text: {
                  description: 'For "add": the text to add.',
                  type: 'string',
                },
                index: {
                  description:
                    'For "update", "remove", "complete": the index of the item (0-based).',
                  type: 'number',
                },
                newText: {
                  description: 'For "update": the new text.',
                  type: 'string',
                },
                completed: {
                  description: 'For "update": the new completed status.',
                  type: 'boolean',
                },
              },
              required: ['type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['operations'],
        type: 'object',
      },
    },
    {
      description: 'Mark todo items as completed by their indices (0-based).',
      name: GTDApiName.completeTodos,
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          indices: {
            description: 'Array of item indices (0-based) to mark as completed.',
            items: { type: 'number' },
            type: 'array',
          },
        },
        required: ['indices'],
        type: 'object',
      },
    },
    {
      description: 'Remove todo items by their indices (0-based).',
      name: GTDApiName.removeTodos,
      humanIntervention: 'always',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          indices: {
            description: 'Array of item indices (0-based) to remove.',
            items: { type: 'number' },
            type: 'array',
          },
        },
        required: ['indices'],
        type: 'object',
      },
    },
    {
      description: 'Clear todo items. Can clear only completed items or all items.',
      name: GTDApiName.clearTodos,
      humanIntervention: 'always',
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          mode: {
            description: '"completed" clears only done items, "all" clears the entire list.',
            enum: ['completed', 'all'],
            type: 'string',
          },
        },
        required: ['mode'],
        type: 'object',
      },
    },

    // ==================== Async Tasks ====================
    {
      description:
        'Execute a single long-running async task. The task runs in an isolated context and can take significant time to complete. Use this for a single complex operation that requires extended processing.',
      name: GTDApiName.execTask,
      parameters: {
        properties: {
          description: {
            description: 'Brief description of what this task does (shown in UI).',
            type: 'string',
          },
          instruction: {
            description: 'Detailed instruction/prompt for the task execution.',
            type: 'string',
          },
          inheritMessages: {
            description:
              'Whether to inherit context messages from the parent conversation. Default is false.',
            type: 'boolean',
          },
          timeout: {
            description: 'Optional timeout in milliseconds. Default is 30 minutes.',
            type: 'number',
          },
        },
        required: ['description', 'instruction'],
        type: 'object',
      },
    },
    {
      description:
        'Execute one or more long-running async tasks. Each task runs in an isolated context and can take significant time to complete. Use this for complex operations that require extended processing.',
      name: GTDApiName.execTasks,
      parameters: {
        properties: {
          tasks: {
            description: 'Array of tasks to execute asynchronously.',
            items: {
              properties: {
                description: {
                  description: 'Brief description of what this task does (shown in UI).',
                  type: 'string',
                },
                instruction: {
                  description: 'Detailed instruction/prompt for the task execution.',
                  type: 'string',
                },
                inheritMessages: {
                  description:
                    'Whether to inherit context messages from the parent conversation. Default is false.',
                  type: 'boolean',
                },
                timeout: {
                  description: 'Optional timeout in milliseconds. Default is 30 minutes.',
                  type: 'number',
                },
              },
              required: ['description', 'instruction'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['tasks'],
        type: 'object',
      },
    },
  ],
  identifier: GTDIdentifier,
  meta: {
    avatar: '✅',
    description: 'Plan goals and track progress with GTD methodology',
    title: 'GTD Tools',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

export { GTDApiName } from './types';
