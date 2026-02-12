import type { BuiltinToolManifest } from '@lobechat/types';

import { isDesktop } from './const';
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
      humanIntervention: 'required',
      renderDisplayControl: 'expand',
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
        required: ['adds'],
        type: 'object',
      },
    },
    {
      description: `Update todo items with batch operations. Each operation type requires specific fields:
- "add": requires "text" (the todo text to add)
- "update": requires "index", optional "newText" and/or "status"
- "remove": requires "index" only
- "complete": requires "index" only (marks item as completed)
- "processing": requires "index" only (marks item as in progress)`,
      name: GTDApiName.updateTodos,
      renderDisplayControl: 'expand',
      parameters: {
        properties: {
          operations: {
            description:
              'Array of update operations. IMPORTANT: For "complete", "processing" and "remove" operations, only pass "type" and "index" - no other fields needed.',
            items: {
              properties: {
                type: {
                  description:
                    'Operation type. "add" needs text, "update" needs index + optional newText/status, "remove", "complete" and "processing" need index only.',
                  enum: ['add', 'update', 'remove', 'complete', 'processing'],
                  type: 'string',
                },
                text: {
                  description: 'Required for "add" only: the text to add.',
                  type: 'string',
                },
                index: {
                  description:
                    'Required for "update", "remove", "complete", "processing": the item index (0-based).',
                  type: 'number',
                },
                newText: {
                  description: 'Optional for "update" only: the new text.',
                  type: 'string',
                },
                status: {
                  description:
                    'Optional for "update" only: set status (todo, processing, completed).',
                  enum: ['todo', 'processing', 'completed'],
                  type: 'string',
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
          ...(isDesktop && {
            runInClient: {
              description:
                'Whether to run on the desktop client (for local file/shell access). MUST be true when task requires local-system tools. Default is false (server execution).',
              type: 'boolean',
            },
          }),
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
                ...(isDesktop && {
                  runInClient: {
                    description:
                      'Whether to run on the desktop client (for local file/shell access). MUST be true when task requires local-system tools. Default is false (server execution).',
                    type: 'boolean',
                  },
                }),
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
    readme:
      'Plan goals and track progress using GTD methodology. Create strategic plans, manage todo lists with status tracking, and execute long-running async tasks.',
    title: 'GTD Tools',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

export { GTDApiName } from './types';
