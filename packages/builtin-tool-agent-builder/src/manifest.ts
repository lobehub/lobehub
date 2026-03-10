import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { AgentBuilderApiName, AgentBuilderIdentifier } from './types';

export const AgentBuilderManifest: BuiltinToolManifest = {
  api: [
    // ==================== Read Operations ====================
    // Note: getAgentConfig, getAgentMeta, getPrompt are removed because
    // the current agent context is now automatically injected into the conversation
    {
      description:
        'Get all available AI models and providers that can be used for the agent. Returns a list of providers with their supported models and capabilities (vision, function calling, reasoning, etc.).',
      name: AgentBuilderApiName.getAvailableModels,
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
      description:
        'Search for tools (MCP plugins) in the marketplace. Users can browse and install tools directly from the search results. Use this when users want to find new tools or capabilities.',
      name: AgentBuilderApiName.searchMarketTools,
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
    // Note: searchOfficialTools is removed because official tools are now
    // automatically injected into the conversation context

    // ==================== Write Operations ====================
    {
      description:
        'Install a plugin for the agent. This tool ALWAYS REQUIRES user approval before installation, even in auto-run mode. For MCP marketplace plugins, it will install and enable the plugin. For Klavis tools and LobehubSkill providers that need OAuth, it will initiate the connection flow and wait for user to complete authorization.',
      name: AgentBuilderApiName.installPlugin,
      parameters: {
        properties: {
          identifier: {
            description:
              'The plugin identifier to install (e.g., "mcp-tavily-search", "google-calendar")',
            type: 'string',
          },
          source: {
            description:
              'Plugin source type: "market" for MCP marketplace plugins, "official" for builtin/Klavis/LobehubSkill tools',
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
        'Update agent configuration and/or metadata. Use this to change model, provider, plugins, opening message, opening questions, chat settings, model parameters, title, description, avatar, tags, and toggle plugins. Only include fields you want to update. Use togglePlugin to enable/disable a specific plugin.',
      name: AgentBuilderApiName.updateAgentConfig,
      parameters: {
        properties: {
          config: {
            description:
              'Partial agent configuration object. Only include fields you want to update.',
            properties: {
              chatConfig: {
                description:
                  'Chat configuration settings (historyCount, enableHistoryCount, enableAutoCreateTopic, autoCreateTopicThreshold, enableCompressHistory, enableStreaming, enableReasoning)',
                type: 'object',
              },
              model: {
                description:
                  'The AI model identifier (e.g., "gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet-20241022", "gemini-1.5-pro")',
                type: 'string',
              },
              openingMessage: {
                description:
                  'Opening message for new conversations. Set to empty string to remove.',
                type: 'string',
              },
              openingQuestions: {
                description:
                  'Array of suggested opening questions. Set to empty array to remove all.',
                items: { type: 'string' },
                type: 'array',
              },
              params: {
                description:
                  'Model parameters like temperature (0-2), top_p (0-1), frequency_penalty (0-2), presence_penalty (0-2)',
                type: 'object',
              },
              plugins: {
                description:
                  'Array of enabled plugin identifiers. Note: prefer using togglePlugin for single plugin changes.',
                items: { type: 'string' },
                type: 'array',
              },
              provider: {
                description:
                  'The AI provider identifier (e.g., "openai", "anthropic", "google", "azure")',
                type: 'string',
              },
            },
            type: 'object',
          },
          meta: {
            description: 'Partial metadata object. Only include fields you want to update.',
            properties: {
              avatar: {
                description: 'Agent avatar (emoji or image URL)',
                type: 'string',
              },
              backgroundColor: {
                description: 'Background color for the agent card',
                type: 'string',
              },
              description: {
                description: 'Agent description',
                type: 'string',
              },
              tags: {
                description: 'Array of tags for categorization',
                items: { type: 'string' },
                type: 'array',
              },
              title: {
                description: 'Agent display name',
                type: 'string',
              },
            },
            type: 'object',
          },
          togglePlugin: {
            description:
              'Toggle a specific plugin on/off. This is the preferred way to enable/disable a single plugin.',
            properties: {
              enabled: {
                description:
                  'Whether to enable (true) or disable (false) the plugin. If not provided, toggles current state.',
                type: 'boolean',
              },
              pluginId: {
                description:
                  'The identifier of the plugin to toggle (e.g., "lobe-web-browsing", "lobe-image-generation")',
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
        "Update the agent's system prompt (systemRole). This is the core instruction that defines how the agent behaves, responds, and interacts with users. Use streaming mode for a typewriter effect in the editor.",
      name: AgentBuilderApiName.updatePrompt,
      parameters: {
        properties: {
          prompt: {
            description:
              'The new system prompt content. Supports markdown formatting. Set to empty string to clear the prompt.',
            type: 'string',
          },
          streaming: {
            description:
              'Whether to use streaming mode for typewriter effect in the editor. Defaults to true for better UX.',
            type: 'boolean',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
    },
  ],
  identifier: AgentBuilderIdentifier,
  meta: {
    avatar: '🛠️',
    title: 'Agent Builder',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
