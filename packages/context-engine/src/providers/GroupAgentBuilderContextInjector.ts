import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GroupAgentBuilderContextInjector');

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
 * Group member info for Group Agent Builder context
 */
export interface GroupMemberItem {
  /** Member's avatar */
  avatar?: string;
  /** Member's description */
  description?: string;
  /** Member ID */
  id: string;
  /** Whether this member is the supervisor */
  isSupervisor?: boolean;
  /** Member's display name */
  title: string;
}

/**
 * Official tool item for Group Agent Builder context
 */
export interface GroupOfficialToolItem {
  /** Tool description */
  description?: string;
  /** Whether the tool is enabled for supervisor agent */
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
 * Group context for Group Agent Builder
 */
export interface GroupAgentBuilderContext {
  /** Group configuration */
  config?: {
    /** Whether the supervisor is enabled */
    enableSupervisor?: boolean;
    /** Opening message shown when starting a new conversation */
    openingMessage?: string;
    /** Suggested opening questions */
    openingQuestions?: string[];
    /** Scene type */
    scene?: string;
    /** Group's system prompt */
    systemPrompt?: string;
  };
  /** Group ID */
  groupId?: string;
  /** Group title */
  groupTitle?: string;
  /** Group members */
  members?: GroupMemberItem[];
  /** Available official tools (builtin tools and Klavis integrations) */
  officialTools?: GroupOfficialToolItem[];
  /** Supervisor agent configuration */
  supervisorConfig?: {
    /** Model being used */
    model?: string;
    /** Enabled plugins */
    plugins?: string[];
    /** Provider being used */
    provider?: string;
  };
}

export interface GroupAgentBuilderContextInjectorConfig {
  /** Whether Group Agent Builder is enabled */
  enabled?: boolean;
  /** Function to format group context */
  formatGroupContext?: (context: GroupAgentBuilderContext) => string;
  /** Group context to inject */
  groupContext?: GroupAgentBuilderContext;
}

/**
 * Format group context as XML for injection
 */
const defaultFormatGroupContext = (context: GroupAgentBuilderContext): string => {
  const parts: string[] = [];

  // Add group meta section
  if (context.groupId || context.groupTitle) {
    const metaFields: string[] = [];
    if (context.groupId) metaFields.push(`  <id>${escapeXml(context.groupId)}</id>`);
    if (context.groupTitle) metaFields.push(`  <title>${escapeXml(context.groupTitle)}</title>`);

    if (metaFields.length > 0) {
      parts.push(`<group_meta>\n${metaFields.join('\n')}\n</group_meta>`);
    }
  }

  // Add group config section
  if (context.config) {
    const configFields: string[] = [];
    if (context.config.scene) {
      configFields.push(`  <scene>${escapeXml(context.config.scene)}</scene>`);
    }
    if (context.config.enableSupervisor !== undefined) {
      configFields.push(
        `  <enableSupervisor>${context.config.enableSupervisor ? 'true' : 'false'}</enableSupervisor>`,
      );
    }
    if (context.config.systemPrompt) {
      // For system prompt, show preview (first 500 chars) to avoid too long context
      const preview =
        context.config.systemPrompt.length > 500
          ? context.config.systemPrompt.slice(0, 500) + '...'
          : context.config.systemPrompt;
      configFields.push(
        `  <systemPrompt length="${context.config.systemPrompt.length}">${escapeXml(preview)}</systemPrompt>`,
      );
    }
    if (context.config.openingMessage) {
      configFields.push(
        `  <openingMessage>${escapeXml(context.config.openingMessage)}</openingMessage>`,
      );
    }
    if (context.config.openingQuestions && context.config.openingQuestions.length > 0) {
      const questionsXml = context.config.openingQuestions
        .map((q) => `    <question>${escapeXml(q)}</question>`)
        .join('\n');
      configFields.push(
        `  <openingQuestions count="${context.config.openingQuestions.length}">\n${questionsXml}\n  </openingQuestions>`,
      );
    }

    if (configFields.length > 0) {
      parts.push(`<group_config>\n${configFields.join('\n')}\n</group_config>`);
    }
  }

  // Add supervisor config section
  if (context.supervisorConfig) {
    const supervisorFields: string[] = [];
    if (context.supervisorConfig.model) {
      supervisorFields.push(
        `  <model provider="${context.supervisorConfig.provider || 'unknown'}">${context.supervisorConfig.model}</model>`,
      );
    }
    if (context.supervisorConfig.plugins && context.supervisorConfig.plugins.length > 0) {
      supervisorFields.push(
        `  <enabled_skills>${context.supervisorConfig.plugins.join(', ')}</enabled_skills>`,
      );
    }

    if (supervisorFields.length > 0) {
      parts.push(
        `<supervisor_agent_config>\n${supervisorFields.join('\n')}\n</supervisor_agent_config>`,
      );
    }
  }

  // Add members section
  if (context.members && context.members.length > 0) {
    const memberItems = context.members
      .map((m) => {
        const attrs = [
          `id="${m.id}"`,
          m.isSupervisor ? 'role="supervisor"' : 'role="participant"',
        ].join(' ');
        const desc = m.description ? ` - ${escapeXml(m.description)}` : '';
        return `    <member ${attrs}>${escapeXml(m.title)}${desc}</member>`;
      })
      .join('\n');
    parts.push(
      `<group_members count="${context.members.length}">\n${memberItems}\n</group_members>`,
    );
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

  return `<current_group_context>
<instruction>This is the current group's configuration context. Use this information when the user asks about or wants to modify group settings. Use inviteAgent/removeAgent to manage members, updatePrompt to modify the group's system prompt, or updateGroupConfig to set opening message and opening questions.</instruction>
${parts.join('\n')}
</current_group_context>`;
};

/**
 * Group Agent Builder Context Injector
 * Responsible for injecting current group context when Group Agent Builder tool is enabled
 */
export class GroupAgentBuilderContextInjector extends BaseProvider {
  readonly name = 'GroupAgentBuilderContextInjector';

  constructor(
    private config: GroupAgentBuilderContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if Group Agent Builder is not enabled
    if (!this.config.enabled) {
      log('Group Agent Builder not enabled, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Skip if no group context
    if (!this.config.groupContext) {
      log('No group context provided, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Format group context
    const formatFn = this.config.formatGroupContext || defaultFormatGroupContext;
    const formattedContent = formatFn(this.config.groupContext);

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

    // Insert a new user message with group context before the first user message
    const groupContextMessage = {
      content: formattedContent,
      createdAt: Date.now(),
      id: `group-agent-builder-context-${Date.now()}`,
      meta: { injectType: 'group-agent-builder-context', systemInjection: true },
      role: 'user' as const,
      updatedAt: Date.now(),
    };

    clonedContext.messages.splice(firstUserIndex, 0, groupContextMessage);

    // Update metadata
    clonedContext.metadata.groupAgentBuilderContextInjected = true;

    log('Group Agent Builder context injected as new user message');

    return this.markAsExecuted(clonedContext);
  }
}
