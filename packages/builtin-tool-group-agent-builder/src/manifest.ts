import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { GroupAgentBuilderApiName, GroupAgentBuilderIdentifier } from './types';

export const GroupAgentBuilderManifest: BuiltinToolManifest = {
  api: [
    // ==================== Group Member Management ====================
    {
      description:
        "Search for agents that can be invited to the group. Returns agents from the user's collection. Use this to find suitable agents before inviting them.",
      name: GroupAgentBuilderApiName.searchAgent,
      parameters: {
        properties: {
          limit: {
            default: 10,
            description: 'Maximum number of results to return (default: 10, max: 20).',
            maximum: 20,
            minimum: 1,
            type: 'number',
          },
          query: {
            description:
              'Search query to find agents by name, description, or capabilities. Leave empty to browse all available agents.',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Create a new agent dynamically based on user requirements and add it to the group. Use this when no existing agent matches the needed expertise.',
      humanIntervention: 'required',
      name: GroupAgentBuilderApiName.createAgent,
      parameters: {
        properties: {
          avatar: {
            description: "An emoji or image URL for the agent's avatar (optional).",
            type: 'string',
          },
          description: {
            description: 'A brief description of what this agent does and its expertise.',
            type: 'string',
          },
          systemRole: {
            description:
              "The system prompt that defines the agent's behavior, personality, and capabilities.",
            type: 'string',
          },
          title: {
            description: 'The display name for the new agent.',
            type: 'string',
          },
          tools: {
            description:
              'Array of tool identifiers to enable for this agent. Use identifiers from official_tools context (e.g., "lobe-cloud-sandbox", "web-crawler").',
            items: { type: 'string' },
            type: 'array',
          },
        },
        required: ['title', 'systemRole'],
        type: 'object',
      },
    },
    {
      description:
        'Create multiple agents at once and add them to the group. Use this to efficiently set up a team of agents with different expertise.',
      humanIntervention: 'required',
      name: GroupAgentBuilderApiName.batchCreateAgents,
      parameters: {
        properties: {
          agents: {
            description: 'Array of agent definitions to create',
            items: {
              properties: {
                /* eslint-disable sort-keys-fix/sort-keys-fix */
                avatar: {
                  description: "An emoji or image URL for the agent's avatar (optional).",
                  type: 'string',
                },
                title: {
                  description: 'The display name for the new agent.',
                  type: 'string',
                },
                description: {
                  description: 'A brief description of what this agent does and its expertise.',
                  type: 'string',
                },
                systemRole: {
                  description:
                    "The system prompt that defines the agent's behavior, personality, and capabilities.",
                  type: 'string',
                },
                tools: {
                  description:
                    'Array of tool identifiers to enable for this agent. Use identifiers from official_tools context (e.g., "lobe-cloud-sandbox", "web-crawler").',
                  items: { type: 'string' },
                  type: 'array',
                },
                /* eslint-enable sort-keys-fix/sort-keys-fix */
              },
              required: ['avatar', 'title', 'description', 'systemRole'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['agents'],
        type: 'object',
      },
    },
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
        'Update agent configuration (model, provider, plugins, etc.). If agentId is not provided, updates the supervisor agent.',
      name: GroupAgentBuilderApiName.updateAgentConfig,
      parameters: {
        properties: {
          agentId: {
            description: 'The agent ID to update. If not provided, updates the supervisor agent.',
            type: 'string',
          },
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
            description: 'Toggle a specific plugin on/off for the agent.',
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
      description: "Update a specific agent's system prompt (systemRole).",
      name: GroupAgentBuilderApiName.updateAgentPrompt,
      parameters: {
        properties: {
          agentId: {
            description: 'The agent ID to update.',
            type: 'string',
          },
          prompt: {
            description: 'The new system prompt content. Supports markdown formatting.',
            type: 'string',
          },
        },
        required: ['agentId', 'prompt'],
        type: 'object',
      },
    },
    {
      description:
        "Update the group's configuration and metadata. Use this to customize the group's appearance and welcome experience.",
      name: GroupAgentBuilderApiName.updateGroup,
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
          meta: {
            description: 'Partial metadata object. Only include fields you want to update.',
            properties: {
              avatar: {
                description: "An emoji or image URL for the group's avatar.",
                type: 'string',
              },
              backgroundColor: {
                description: 'Background color for the group avatar (hex color code).',
                type: 'string',
              },
              description: {
                description: 'A brief description of the group.',
                type: 'string',
              },
              title: {
                description: 'The display name for the group.',
                type: 'string',
              },
            },
            type: 'object',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        "Update the group's shared prompt/content. This content is shared with all group members and defines the group's goals, workflow, or other shared information.",
      name: GroupAgentBuilderApiName.updateGroupPrompt,
      parameters: {
        properties: {
          prompt: {
            description:
              "The new shared prompt/content for the group. Supports markdown formatting. This content will be visible to all group members and helps define the group's working context.",
            type: 'string',
          },
        },
        required: ['prompt'],
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
