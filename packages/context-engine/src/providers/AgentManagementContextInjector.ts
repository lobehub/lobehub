import { escapeXml } from '@lobechat/prompts';
import type { RuntimeMentionedAgent } from '@lobechat/types';
import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentManagementContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:AgentManagementContextInjector');

/**
 * Available model info for Agent Management context
 */
export interface AvailableModelInfo {
  /** Model abilities */
  abilities?: {
    files?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
  /** Model description */
  description?: string;
  /** Model ID */
  id: string;
  /** Model display name */
  name: string;
}

/**
 * Available provider info for Agent Management context
 */
export interface AvailableProviderInfo {
  /** Provider ID */
  id: string;
  /** Available models under this provider */
  models: AvailableModelInfo[];
  /** Provider display name */
  name: string;
}

/**
 * Available plugin info for Agent Management context
 */
export interface AvailablePluginInfo {
  /** Plugin description */
  description?: string;
  /** Plugin identifier */
  identifier: string;
  /** Plugin display name */
  name: string;
  /** Plugin type: 'builtin' for built-in tools, 'klavis' for Klavis servers, 'lobehub-skill' for LobehubSkill providers */
  type: 'builtin' | 'klavis' | 'lobehub-skill';
}

/**
 * Agent Management context
 */
export interface AgentManagementContext {
  /** Available plugins (all types) */
  availablePlugins?: AvailablePluginInfo[];
  /** Available providers and models */
  availableProviders?: AvailableProviderInfo[];
  /** Agents @mentioned by the user — supervisor should delegate to these via callAgent */
  mentionedAgents?: RuntimeMentionedAgent[];
}

export interface AgentManagementContextInjectorConfig {
  /** Agent Management context to inject */
  context?: AgentManagementContext;
  /** Whether Agent Management tool is enabled */
  enabled?: boolean;
  /** Function to format Agent Management context */
  formatContext?: (context: AgentManagementContext) => string;
}

/**
 * Format Agent Management context as XML for injection
 */
const defaultFormatContext = (context: AgentManagementContext): string => {
  const parts: string[] = [];

  // Add available models section
  if (context.availableProviders && context.availableProviders.length > 0) {
    const providersXml = context.availableProviders
      .map((provider) => {
        const modelsXml = provider.models
          .map((model) => {
            const attrs: string[] = [`id="${model.id}"`];
            if (model.abilities) {
              if (model.abilities.functionCall) attrs.push('functionCall="true"');
              if (model.abilities.vision) attrs.push('vision="true"');
              if (model.abilities.files) attrs.push('files="true"');
              if (model.abilities.reasoning) attrs.push('reasoning="true"');
            }
            const desc = model.description ? ` - ${escapeXml(model.description)}` : '';
            return `      <model ${attrs.join(' ')}>${escapeXml(model.name)}${desc}</model>`;
          })
          .join('\n');
        return `    <provider id="${provider.id}" name="${escapeXml(provider.name)}">\n${modelsXml}\n    </provider>`;
      })
      .join('\n');

    parts.push(`<available_models>\n${providersXml}\n</available_models>`);
  }

  // Add available plugins section
  if (context.availablePlugins && context.availablePlugins.length > 0) {
    const builtinPlugins = context.availablePlugins.filter((p) => p.type === 'builtin');
    const klavisPlugins = context.availablePlugins.filter((p) => p.type === 'klavis');
    const lobehubSkillPlugins = context.availablePlugins.filter((p) => p.type === 'lobehub-skill');

    const pluginsSections: string[] = [];

    if (builtinPlugins.length > 0) {
      const builtinItems = builtinPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(`  <builtin_plugins>\n${builtinItems}\n  </builtin_plugins>`);
    }

    if (klavisPlugins.length > 0) {
      const klavisItems = klavisPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(`  <klavis_plugins>\n${klavisItems}\n  </klavis_plugins>`);
    }

    if (lobehubSkillPlugins.length > 0) {
      const lobehubSkillItems = lobehubSkillPlugins
        .map((p) => {
          const desc = p.description ? ` - ${escapeXml(p.description)}` : '';
          return `    <plugin id="${p.identifier}">${escapeXml(p.name)}${desc}</plugin>`;
        })
        .join('\n');
      pluginsSections.push(
        `  <lobehub_skill_plugins>\n${lobehubSkillItems}\n  </lobehub_skill_plugins>`,
      );
    }

    if (pluginsSections.length > 0) {
      parts.push(`<available_plugins>\n${pluginsSections.join('\n')}\n</available_plugins>`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return `<agent_management_context>
<instruction>When creating or updating agents using the Agent Management tools, you can select from these available models and plugins. Use the exact IDs from this context when specifying model/provider/plugins parameters.</instruction>
${parts.join('\n')}
</agent_management_context>`;
};

/**
 * Format mentioned agents as delegation context for injection after the user message.
 * Instructs the AI to delegate to the mentioned agent(s) via callAgent.
 */
const formatMentionedAgentsContext = (mentionedAgents: RuntimeMentionedAgent[]): string => {
  const agentsXml = mentionedAgents
    .map((a) => `  <agent id="${escapeXml(a.id)}" name="${escapeXml(a.name)}" />`)
    .join('\n');

  return `<mentioned_agents>
<instruction>The user has @mentioned the following agent(s) in their message. You MUST call the \`lobe-agent-management____callAgent____builtin\` tool to delegate the user's request to the mentioned agent. Do NOT attempt to handle the request yourself — call the agent and let them respond.</instruction>
${agentsXml}
</mentioned_agents>`;
};

/**
 * Agent Management Context Injector
 * Responsible for injecting available models and plugins when Agent Management tool is enabled
 */
export class AgentManagementContextInjector extends BaseProvider {
  readonly name = 'AgentManagementContextInjector';

  constructor(
    private config: AgentManagementContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if Agent Management is not enabled
    if (!this.config.enabled) {
      log('Agent Management not enabled, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Skip if no context data
    if (!this.config.context) {
      log('No Agent Management context provided, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasMentionedAgents =
      this.config.context.mentionedAgents && this.config.context.mentionedAgents.length > 0;

    // Format context (excluding mentionedAgents — those are injected separately after the last user message)
    const contextWithoutMentions: AgentManagementContext = hasMentionedAgents
      ? {
          availablePlugins: this.config.context.availablePlugins,
          availableProviders: this.config.context.availableProviders,
        }
      : this.config.context;

    const formatFn = this.config.formatContext || defaultFormatContext;
    const formattedContent = formatFn(contextWithoutMentions);

    // Inject agent-management context (providers/plugins) before the first user message
    if (formattedContent) {
      const firstUserIndex = clonedContext.messages.findIndex((msg) => msg.role === 'user');

      if (firstUserIndex !== -1) {
        const contextMessage = {
          content: formattedContent,
          createdAt: Date.now(),
          id: `agent-management-context-${Date.now()}`,
          meta: { injectType: 'agent-management-context', systemInjection: true },
          role: 'user' as const,
          updatedAt: Date.now(),
        };

        clonedContext.messages.splice(firstUserIndex, 0, contextMessage);
        clonedContext.metadata.agentManagementContextInjected = true;
        log('Agent Management context injected before first user message');
      }
    }

    // Inject mentionedAgents delegation context AFTER the last user message
    // This position makes the delegation instruction most salient to the model
    if (hasMentionedAgents) {
      const mentionedContent = formatMentionedAgentsContext(this.config.context.mentionedAgents!);

      // Find the last user message index
      let lastUserIndex = -1;
      for (let i = clonedContext.messages.length - 1; i >= 0; i--) {
        if (clonedContext.messages[i].role === 'user') {
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex !== -1) {
        const mentionMessage = {
          content: mentionedContent,
          createdAt: Date.now(),
          id: `agent-mention-delegation-${Date.now()}`,
          meta: { injectType: 'agent-mention-delegation', systemInjection: true },
          role: 'user' as const,
          updatedAt: Date.now(),
        };

        // Insert after the last user message
        clonedContext.messages.splice(lastUserIndex + 1, 0, mentionMessage);
        log('Mentioned agents delegation context injected after last user message');
      }
    }

    return this.markAsExecuted(clonedContext);
  }
}
