import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:AgentBuilderContextInjector');

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
 * Official tool item for Agent Builder context
 */
export interface OfficialToolItem {
  /** Tool description */
  description?: string;
  /** Whether the tool is enabled for current agent */
  enabled?: boolean;
  /** Tool identifier */
  identifier: string;
  /** Whether the tool is installed/connected */
  installed?: boolean;
  /** Tool display name */
  name: string;
  /** Tool type: 'builtin' for built-in tools, 'klavis' for LobeHub Mcp servers */
  type: 'builtin' | 'klavis';
}

/**
 * Agent context for Agent Builder
 */
export interface AgentBuilderContext {
  /** Agent configuration */
  config?: {
    chatConfig?: Record<string, any>;
    model?: string;
    openingMessage?: string;
    openingQuestions?: string[];
    params?: Record<string, any>;
    plugins?: string[];
    provider?: string;
    systemRole?: string;
  };
  /** Agent metadata */
  meta?: {
    avatar?: string;
    backgroundColor?: string;
    description?: string;
    tags?: string[];
    title?: string;
  };
  /** Available official tools (builtin tools and Klavis integrations) */
  officialTools?: OfficialToolItem[];
}

export interface AgentBuilderContextInjectorConfig {
  /** Agent context to inject */
  agentContext?: AgentBuilderContext;
  /** Whether Agent Builder is enabled */
  enabled?: boolean;
  /** Function to format agent context */
  formatAgentContext?: (context: AgentBuilderContext) => string;
}

/**
 * Format agent context as XML for injection
 */
const defaultFormatAgentContext = (context: AgentBuilderContext): string => {
  const parts: string[] = [];

  // Add meta section
  if (context.meta) {
    const metaFields: string[] = [];
    if (context.meta.title) metaFields.push(`  <title>${escapeXml(context.meta.title)}</title>`);
    if (context.meta.description)
      metaFields.push(`  <description>${escapeXml(context.meta.description)}</description>`);
    if (context.meta.avatar)
      metaFields.push(`  <avatar>${escapeXml(context.meta.avatar)}</avatar>`);
    if (context.meta.backgroundColor)
      metaFields.push(`  <backgroundColor>${context.meta.backgroundColor}</backgroundColor>`);
    if (context.meta.tags && context.meta.tags.length > 0)
      metaFields.push(`  <tags>${context.meta.tags.join(', ')}</tags>`);

    if (metaFields.length > 0) {
      parts.push(`<agent_meta>\n${metaFields.join('\n')}\n</agent_meta>`);
    }
  }

  // Add config section
  if (context.config) {
    const configFields: string[] = [];
    if (context.config.model)
      configFields.push(
        `  <model provider="${context.config.provider || 'unknown'}">${context.config.model}</model>`,
      );
    if (context.config.plugins && context.config.plugins.length > 0)
      configFields.push(
        `  <enabled_plugins>${context.config.plugins.join(', ')}</enabled_plugins>`,
      );
    if (context.config.openingMessage)
      configFields.push(
        `  <openingMessage>${escapeXml(context.config.openingMessage)}</openingMessage>`,
      );
    if (context.config.openingQuestions && context.config.openingQuestions.length > 0) {
      const questions = context.config.openingQuestions
        .map((q) => `    <question>${escapeXml(q)}</question>`)
        .join('\n');
      configFields.push(`  <openingQuestions>\n${questions}\n  </openingQuestions>`);
    }
    if (context.config.systemRole) {
      // For system role, show preview (first 500 chars) to avoid too long context
      const preview =
        context.config.systemRole.length > 500
          ? context.config.systemRole.slice(0, 500) + '...'
          : context.config.systemRole;
      configFields.push(
        `  <systemRole length="${context.config.systemRole.length}">${escapeXml(preview)}</systemRole>`,
      );
    }

    if (configFields.length > 0) {
      parts.push(`<agent_config>\n${configFields.join('\n')}\n</agent_config>`);
    }
  }

  // Add official tools section
  if (context.officialTools && context.officialTools.length > 0) {
    const builtinTools = context.officialTools.filter((t) => t.type === 'builtin');
    const klavisTools = context.officialTools.filter((t) => t.type === 'klavis');

    const toolsSections: string[] = [];

    if (builtinTools.length > 0) {
      const builtinItems = builtinTools
        .map((t) => {
          const attrs = [`id="${t.identifier}"`, `enabled="${t.enabled ? 'true' : 'false'}"`].join(
            ' ',
          );
          const desc = t.description ? ` - ${escapeXml(t.description)}` : '';
          return `    <tool ${attrs}>${escapeXml(t.name)}${desc}</tool>`;
        })
        .join('\n');
      toolsSections.push(`  <builtin_tools>\n${builtinItems}\n  </builtin_tools>`);
    }

    if (klavisTools.length > 0) {
      const klavisItems = klavisTools
        .map((t) => {
          const attrs = [
            `id="${t.identifier}"`,
            `installed="${t.installed ? 'true' : 'false'}"`,
            `enabled="${t.enabled ? 'true' : 'false'}"`,
          ].join(' ');
          const desc = t.description ? ` - ${escapeXml(t.description)}` : '';
          return `    <tool ${attrs}>${escapeXml(t.name)}${desc}</tool>`;
        })
        .join('\n');
      toolsSections.push(`  <klavis_tools>\n${klavisItems}\n  </klavis_tools>`);
    }

    if (toolsSections.length > 0) {
      parts.push(
        `<available_official_tools>\n${toolsSections.join('\n')}\n</available_official_tools>`,
      );
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return `<current_agent_context>
<instruction>This is the current agent's configuration context. Use this information when the user asks about or wants to modify agent settings. Use togglePlugin to enable/disable tools, or installPlugin to install new tools.</instruction>
${parts.join('\n')}
</current_agent_context>`;
};

/**
 * Agent Builder Context Injector
 * Responsible for injecting current agent context when Agent Builder tool is enabled
 */
export class AgentBuilderContextInjector extends BaseProvider {
  readonly name = 'AgentBuilderContextInjector';

  constructor(
    private config: AgentBuilderContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if Agent Builder is not enabled
    if (!this.config.enabled) {
      log('Agent Builder not enabled, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Skip if no agent context
    if (!this.config.agentContext) {
      log('No agent context provided, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Format agent context
    const formatFn = this.config.formatAgentContext || defaultFormatAgentContext;
    const formattedContent = formatFn(this.config.agentContext);

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

    // Insert a new user message with agent context before the first user message
    const agentContextMessage = {
      content: formattedContent,
      createdAt: Date.now(),
      id: `agent-builder-context-${Date.now()}`,
      meta: { injectType: 'agent-builder-context', systemInjection: true },
      role: 'user' as const,
      updatedAt: Date.now(),
    };

    clonedContext.messages.splice(firstUserIndex, 0, agentContextMessage);

    // Update metadata
    clonedContext.metadata.agentBuilderContextInjected = true;

    log('Agent Builder context injected as new user message');

    return this.markAsExecuted(clonedContext);
  }
}
