import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AgentManagementApiName, AgentManagementIdentifier } from './types';

export const AgentManagementManifest: BuiltinToolManifest = {
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  api: [
    // ==================== Agent CRUD ====================
    {
      description:
        'Create a new AI agent with custom configuration. The agent will be added to your workspace and can be used for conversations or tasks.',
      name: AgentManagementApiName.createAgent,
      parameters: {
        properties: {
          title: {
            description: 'The display name for the agent (required)',
            type: 'string',
          },
          description: {
            description: 'A brief description of what the agent does',
            type: 'string',
          },
          systemRole: {
            description:
              "The system prompt that defines the agent's personality, expertise, and behavior. This is the core instruction for the agent.",
            type: 'string',
          },
          avatar: {
            description: 'Agent avatar (emoji like "🤖" or image URL)',
            type: 'string',
          },
          backgroundColor: {
            description: 'Background color for the agent card (hex color code)',
            type: 'string',
          },
          model: {
            description:
              'The AI model to use (e.g., "gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022")',
            type: 'string',
          },
          provider: {
            description: 'The AI provider (e.g., "openai", "anthropic", "google")',
            type: 'string',
          },
          plugins: {
            description: 'Array of plugin identifiers to enable for this agent',
            items: { type: 'string' },
            type: 'array',
          },
          openingMessage: {
            description: 'Welcome message displayed when starting a new conversation',
            type: 'string',
          },
          openingQuestions: {
            description: 'Suggested questions to help users start the conversation',
            items: { type: 'string' },
            type: 'array',
          },
          tags: {
            description: 'Tags for categorizing the agent',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['title'],
        type: 'object',
      },
    },
    {
      description:
        'Update an existing agent configuration. Only include fields you want to change.',
      name: AgentManagementApiName.updateAgent,
      parameters: {
        properties: {
          agentId: {
            description: 'The ID of the agent to update',
            type: 'string',
          },
          config: {
            description: 'Partial agent configuration to update',
            properties: {
              model: {
                description: 'The AI model to use',
                type: 'string',
              },
              provider: {
                description: 'The AI provider',
                type: 'string',
              },
              systemRole: {
                description: 'The system prompt',
                type: 'string',
              },
              plugins: {
                description: 'Array of enabled plugin identifiers',
                items: { type: 'string' },
                type: 'array',
              },
              openingMessage: {
                description: 'Opening message for new conversations',
                type: 'string',
              },
              openingQuestions: {
                description: 'Suggested opening questions',
                items: { type: 'string' },
                type: 'array',
              },
            },
            type: 'object',
          },
          meta: {
            description: 'Partial metadata to update',
            properties: {
              title: {
                description: 'Agent display name',
                type: 'string',
              },
              description: {
                description: 'Agent description',
                type: 'string',
              },
              avatar: {
                description: 'Agent avatar',
                type: 'string',
              },
              backgroundColor: {
                description: 'Background color',
                type: 'string',
              },
              tags: {
                description: 'Tags for categorization',
                items: { type: 'string' },
                type: 'array',
              },
            },
            type: 'object',
          },
        },
        required: ['agentId'],
        type: 'object',
      },
    },
    {
      description:
        'Delete an agent from your workspace. This action cannot be undone. The agent and its associated session will be removed.',
      humanIntervention: 'required',
      name: AgentManagementApiName.deleteAgent,
      parameters: {
        properties: {
          agentId: {
            description: 'The ID of the agent to delete',
            type: 'string',
          },
        },
        required: ['agentId'],
        type: 'object',
      },
    },

    // ==================== Search ====================
    {
      description:
        "Search for agents in your workspace or the marketplace. Use 'user' source to find your own agents, 'market' for marketplace agents, or 'all' for both.",
      name: AgentManagementApiName.searchAgent,
      parameters: {
        properties: {
          keyword: {
            description: 'Search keywords to find agents by name or description',
            type: 'string',
          },
          source: {
            description:
              "Where to search: 'user' (your agents), 'market' (marketplace), 'all' (both). Default: 'all'",
            enum: ['user', 'market', 'all'],
            type: 'string',
          },
          category: {
            description:
              'Category filter for marketplace search (e.g., "programming", "writing", "translation")',
            type: 'string',
          },
          limit: {
            default: 10,
            description: 'Maximum number of results to return (default: 10, max: 20)',
            type: 'number',
          },
        },
        required: [],
        type: 'object',
      },
    },

    // ==================== Execution ====================
    {
      description:
        'Call an agent to handle a specific task or respond to an instruction. Can run synchronously (immediate response) or as a background task for longer operations.',
      name: AgentManagementApiName.callAgent,
      parameters: {
        properties: {
          agentId: {
            description: 'The ID of the agent to call',
            type: 'string',
          },
          instruction: {
            description:
              'The instruction or task for the agent to execute. Be specific about expected deliverables.',
            type: 'string',
          },
          runAsTask: {
            default: false,
            description:
              'If true, run as a background task for longer operations. The agent will work asynchronously and return results upon completion.',
            type: 'boolean',
          },
          taskTitle: {
            description: 'Brief title for the task (shown in UI). Required when runAsTask is true.',
            type: 'string',
          },
          timeout: {
            default: 1_800_000,
            description:
              'Maximum time in milliseconds to wait for task completion (default: 1800000 = 30 minutes). Only applies when runAsTask is true.',
            type: 'number',
          },
          skipCallSupervisor: {
            default: false,
            description:
              'If true (and in a group context), the orchestration will end after this agent responds, without calling the supervisor again. Only relevant when used within agent groups.',
            type: 'boolean',
          },
        },
        required: ['agentId', 'instruction'],
        type: 'object',
      },
    },
  ],
  identifier: AgentManagementIdentifier,
  meta: {
    avatar: '🤖',
    description: 'Create, manage, and orchestrate AI agents',
    title: 'Agent Management',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};

export { AgentManagementApiName, AgentManagementIdentifier } from './types';
