import { escapeXml } from '@lobechat/prompts';
import type { RuntimeMentionedAgent } from '@lobechat/types';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
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
 * Available agent info for Agent Management context
 */
export interface AvailableAgentInfo {
  /** Agent description */
  description?: string;
  /** Agent ID */
  id: string;
  /** Agent display name */
  title: string;
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
  /**
   * User's recently updated agents — surfaced so the model can callAgent without
   * searchAgent first. The current/responding agent is NEVER included here, so
   * the model has no exposure to its own id from this section and cannot
   * accidentally delegate to itself. Filtering happens at the caller side
   * (server `aiAgent` and client `contextEngineering`).
   */
  availableAgents?: AvailableAgentInfo[];
  /** Whether the user has more agents than the ones listed in `availableAgents` */
  availableAgentsHasMore?: boolean;
  /** Available plugins (all types) */
  availablePlugins?: AvailablePluginInfo[];
  /** Available providers and models */
  availableProviders?: AvailableProviderInfo[];
  /**
   * The current responding agent's id and title.
   * Exposed so the model can use Agent Management tools (updateAgent, getAgentDetail,
   * installPlugin, etc.) to manage itself when the user asks to modify the current agent.
   */
  currentAgent?: { id: string; title?: string };
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

  // Add current agent identity so the model can self-manage
  if (context.currentAgent) {
    const titleAttr = context.currentAgent.title
      ? ` title="${escapeXml(context.currentAgent.title)}"`
      : '';
    parts.push(`<current_agent id="${escapeXml(context.currentAgent.id)}"${titleAttr} />`);
  }

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

  // Add available agents section (user's existing agents — never includes the current agent;
  // the caller filters self out so the model has no exposure to its own id from this section)
  if (context.availableAgents && context.availableAgents.length > 0) {
    const agentsXml = context.availableAgents
      .map((agent) => {
        const desc = agent.description ? ` - ${escapeXml(agent.description)}` : '';
        return `    <agent id="${escapeXml(agent.id)}">${escapeXml(agent.title)}${desc}</agent>`;
      })
      .join('\n');
    const hasMoreNote = context.availableAgentsHasMore
      ? `\n  <note>Only the ${context.availableAgents.length} most recently updated agents are listed here. The user has more agents — use the Agent Management \`searchAgent\` tool (source="user" + keyword) to find others.</note>`
      : '';
    parts.push(`<available_agents>${hasMoreNote}\n${agentsXml}\n</available_agents>`);
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

  // Build instruction dynamically based on which sections are actually present.
  // (e.g. in "auto" mode we may inject only <available_agents> without models/plugins.)
  const hasModelsOrPlugins =
    (context.availableProviders && context.availableProviders.length > 0) ||
    (context.availablePlugins && context.availablePlugins.length > 0);
  const hasAgents = context.availableAgents && context.availableAgents.length > 0;

  const instructionParts: string[] = [];
  if (context.currentAgent) {
    instructionParts.push(
      'The `current_agent` tag is YOU — your own agent ID. When the user asks to modify your settings (model, plugins, system prompt, etc.), use this ID with updateAgent, getAgentDetail, installPlugin, or other Agent Management tools to manage yourself. Do NOT call yourself via callAgent.',
    );
  }
  if (hasModelsOrPlugins) {
    instructionParts.push(
      'When creating or updating agents using the Agent Management tools, you can select from these available models and plugins. Use the exact IDs from this context when specifying model/provider/plugins parameters.',
    );
  }
  if (hasAgents) {
    instructionParts.push(
      "The `available_agents` section lists the user's other existing agents (you are not in this list). When the user's request clearly matches one of them, you may delegate to it via the Agent Management `callAgent` tool (activating the tool first if it is not already enabled). If no listed agent matches, use `searchAgent` to look further (including the marketplace).",
    );
  }

  return `<agent_management_context>
<instruction>${instructionParts.join(' ')}</instruction>
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
 *
 * Has two injection points:
 *
 * 1. **Before first user message** — providers/plugins/availableAgents XML.
 *    Goes through `BaseFirstUserContentProvider` so it merges with other
 *    `systemInjection: true` providers (UserMemory, Knowledge, AgentBuilder,
 *    ...) into a single consolidated message, preserving Phase 3 ordering
 *    and prefix-cache friendliness.
 *
 * 2. **After last user message** — `<mentioned_agents>` delegation hint.
 *    Always its own standalone message because position matters for model
 *    salience (delegation instructions need to be the last thing the model
 *    sees before responding). Handled by overriding `doProcess` to splice
 *    after `super.doProcess()` returns.
 */
export class AgentManagementContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'AgentManagementContextInjector';

  constructor(
    private config: AgentManagementContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  /**
   * Build the providers/plugins/availableAgents context block for the
   * before-first-user merged injection. Excludes `mentionedAgents` — those
   * have a different injection position and are handled in `doProcess`.
   */
  protected buildContent(_context: PipelineContext): string | null {
    if (!this.config.enabled) {
      log('Agent Management not enabled, skipping before-first-user injection');
      return null;
    }

    if (!this.config.context) {
      log('No Agent Management context provided, skipping before-first-user injection');
      return null;
    }

    // Use a destructure-rest copy so future fields (e.g. currentAgent) don't
    // silently get dropped here.
    const { mentionedAgents: _mentioned, ...contextWithoutMentions } = this.config.context;

    const formatFn = this.config.formatContext || defaultFormatContext;
    const formattedContent = formatFn(contextWithoutMentions);

    if (!formattedContent) {
      log('No agent-management content to inject after formatting');
      return null;
    }

    log('Agent Management context prepared for before-first-user merge');
    return formattedContent;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    // 1) Let BaseFirstUserContentProvider handle the before-first-user merge
    let result = await super.doProcess(context);

    // Track metadata when we actually injected content
    if (this.config.enabled && this.config.context) {
      const { mentionedAgents: _m, ...rest } = this.config.context;
      const formatFn = this.config.formatContext || defaultFormatContext;
      if (formatFn(rest)) {
        result.metadata.agentManagementContextInjected = true;
      }
    }

    // 2) Handle mentionedAgents — separate standalone message after last user
    if (!this.config.enabled || !this.config.context) {
      return result;
    }

    const hasMentionedAgents =
      this.config.context.mentionedAgents && this.config.context.mentionedAgents.length > 0;

    if (!hasMentionedAgents) {
      return result;
    }

    // Clone again only if super.doProcess didn't already (i.e. when buildContent
    // returned null). cloneContext is cheap and idempotent at this granularity.
    result = this.cloneContext(result);

    const mentionedContent = formatMentionedAgentsContext(this.config.context.mentionedAgents!);

    // Find the last user message index — but skip the synthetic systemInjection
    // wrapper messages so we anchor to a real user turn.
    let lastUserIndex = -1;
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      if (msg.role === 'user' && !msg.meta?.systemInjection) {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex !== -1) {
      // NOTE: deliberately NOT tagging this with `systemInjection: true`.
      // The delegation hint is a standalone instruction anchored after the
      // last user message — it must NOT be picked up as the "consolidated
      // system context" by subsequent BaseFirstUserContentProvider injectors
      // (which would mistakenly append identity / memory / etc. into the
      // delegation block).
      const mentionMessage = {
        content: mentionedContent,
        createdAt: Date.now(),
        id: `agent-mention-delegation-${Date.now()}`,
        meta: { injectType: 'agent-mention-delegation' },
        role: 'user' as const,
        updatedAt: Date.now(),
      };

      result.messages.splice(lastUserIndex + 1, 0, mentionMessage);
      log('Mentioned agents delegation context injected after last user message');
    }

    return result;
  }
}
