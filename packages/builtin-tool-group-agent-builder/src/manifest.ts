import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

export const GroupAgentBuilderManifest: BuiltinToolManifest = {
  api: [
    // ==================== Group Member Management ====================
    {
      description:
        'Invite an existing agent to join the group. The agent will become a member and participate in group conversations.',
      name: GroupAgentBuilderApiName.inviteAgent,
      parameters: {
        properties: {
          agentId: {
            description: 'The agent identifier to invite to the group',
            type: 'string',
          },
        },
        required: ['agentId'],
        type: 'object',
      },
    },
    {
      description: 'Remove an agent from the group. Note: The supervisor agent cannot be removed.',
      name: GroupAgentBuilderApiName.removeAgent,
      parameters: {
        properties: {
          agentId: {
            description: 'The agent identifier to remove from the group',
            type: 'string',
          },
        },
        required: ['agentId'],
        type: 'object',
      },
    },

    // ==================== Read Operations (from AgentBuilder) ====================
    {
      description:
        'Get all available AI models and providers that can be used for the supervisor agent. Returns a list of providers with their supported models and capabilities.',
      name: GroupAgentBuilderApiName.getAvailableModels,
      parameters: {
        properties: {
          providerId: {
            description:
              'Optional: filter models by a specific provider id (e.g., "openai", "anthropic", "google")',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description: 'Search for tools (MCP plugins) in the marketplace for the supervisor agent.',
      name: GroupAgentBuilderApiName.searchMarketTools,
      parameters: {
        properties: {
          category: {
            description:
              'Optional: filter by category. Available categories: developer, productivity, web-search, tools, media-generate, etc.',
            type: 'string',
          },
          pageSize: {
            description: 'Optional: number of results to return (default: 10, max: 20).',
            type: 'number',
          },
          query: {
            description:
              'Optional: search keywords to find specific tools. Leave empty to browse all available tools.',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },

    // ==================== Write Operations ====================
    {
      description:
        'Install a plugin for the supervisor agent. This tool ALWAYS REQUIRES user approval before installation.',
      humanIntervention: 'always',
      name: GroupAgentBuilderApiName.installPlugin,
      parameters: {
        properties: {
          identifier: {
            description:
              'The plugin identifier to install (e.g., "mcp-tavily-search", "google-calendar")',
            type: 'string',
          },
          source: {
            description:
              'Plugin source type: "market" for MCP marketplace plugins, "official" for builtin/Klavis tools',
            enum: ['market', 'official'],
            type: 'string',
          },
        },
        required: ['identifier', 'source'],
        type: 'object',
      },
    },
    {
      description:
        'Update supervisor agent configuration (model, provider, plugins, etc.). Only include fields you want to update.',
      name: GroupAgentBuilderApiName.updateAgentConfig,
      parameters: {
        properties: {
          config: {
            description:
              'Partial agent configuration object. Only include fields you want to update.',
            properties: {
              chatConfig: {
                description:
                  'Chat configuration settings (historyCount, enableHistoryCount, enableAutoCreateTopic, etc.)',
                type: 'object',
              },
              model: {
                description:
                  'The AI model identifier (e.g., "gpt-4o", "claude-sonnet-4-5-20250929")',
                type: 'string',
              },
              params: {
                description: 'Model parameters like temperature (0-2), top_p (0-1), etc.',
                type: 'object',
              },
              plugins: {
                description: 'Array of enabled plugin identifiers.',
                items: { type: 'string' },
                type: 'array',
              },
              provider: {
                description: 'The AI provider identifier (e.g., "openai", "anthropic", "google")',
                type: 'string',
              },
            },
            type: 'object',
          },
          togglePlugin: {
            description: 'Toggle a specific plugin on/off for the supervisor agent.',
            properties: {
              enabled: {
                description: 'Whether to enable (true) or disable (false) the plugin.',
                type: 'boolean',
              },
              pluginId: {
                description: 'The identifier of the plugin to toggle',
                type: 'string',
              },
            },
            required: ['pluginId'],
            type: 'object',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        "Update the group's system prompt. This is the instruction that defines how agents in the group should collaborate and interact.",
      name: GroupAgentBuilderApiName.updatePrompt,
      parameters: {
        properties: {
          prompt: {
            description: 'The new group system prompt content. Supports markdown formatting.',
            type: 'string',
          },
          streaming: {
            description:
              'Whether to use streaming mode for typewriter effect in the editor. Defaults to true.',
            type: 'boolean',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
    {
      description:
        "Update the group's configuration including opening message and opening questions. Use this to set the welcome experience when users start a new conversation with the group.",
      name: GroupAgentBuilderApiName.updateGroupConfig,
      parameters: {
        properties: {
          config: {
            description:
              'Partial group configuration object. Only include fields you want to update.',
            properties: {
              openingMessage: {
                description:
                  'Opening message shown when starting a new conversation with the group. Set to empty string to remove.',
                type: 'string',
              },
              openingQuestions: {
                description:
                  'Array of suggested opening questions to help users get started. Set to empty array to remove all.',
                items: { type: 'string' },
                type: 'array',
              },
            },
            type: 'object',
          },
        },
        required: ['config'],
        type: 'object',
      },
    },
  ],
  identifier: GroupAgentBuilderIdentifier,
  meta: {
    avatar: '👥',
    title: 'Group Agent Builder',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
