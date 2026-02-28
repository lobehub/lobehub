import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:AgentManagementContextInjector');

/**
 * Escape XML special characters
 */
const escapeXml = (str: string): string => {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
};

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

    // Format context
    const formatFn = this.config.formatContext || defaultFormatContext;
    const formattedContent = formatFn(this.config.context);

    // Skip if no content to inject
    if (!formattedContent) {
      log('No content to inject after formatting');
      return this.markAsExecuted(clonedContext);
    }

    // Find the first user message index
    const firstUserIndex = clonedContext.messages.findIndex((msg) => msg.role === 'user');

    if (firstUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Insert a new user message with context before the first user message
    const contextMessage = {
      content: formattedContent,
      createdAt: Date.now(),
      id: `agent-management-context-${Date.now()}`,
      meta: { injectType: 'agent-management-context', systemInjection: true },
      role: 'user' as const,
      updatedAt: Date.now(),
    };

    clonedContext.messages.splice(firstUserIndex, 0, contextMessage);

    // Update metadata
    clonedContext.metadata.agentManagementContextInjected = true;

    log('Agent Management context injected as new user message');

    return this.markAsExecuted(clonedContext);
  }
}
