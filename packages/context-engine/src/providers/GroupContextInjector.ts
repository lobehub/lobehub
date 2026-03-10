import type { GroupContextMemberInfo } from '@lobechat/prompts';
import { formatGroupMembers, groupContextTemplate } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GroupContextInjector');

/**
 * Group member info for context injection
 * Re-export from @lobechat/prompts for convenience
 */
export type GroupMemberInfo = GroupContextMemberInfo;

/**
 * Configuration for GroupContextInjector
 */
export interface GroupContextInjectorConfig {
  /**
   * Current agent's ID (the one who will respond)
   */
  currentAgentId?: string;

  /**
   * Current agent's name
   */
  currentAgentName?: string;

  /**
   * Current agent's role
   */
  currentAgentRole?: 'supervisor' | 'participant';

  /**
   * Whether this is a group chat context
   */
  enabled?: boolean;

  /**
   * Group title/name
   */
  groupTitle?: string;

  /**
   * List of group members
   */
  members?: GroupMemberInfo[];

  /**
   * Custom system prompt/role description for the group
   */
  systemPrompt?: string;
}

/**
 * Group Context Injector
 *
 * Responsible for injecting group context information before the first user message
 * for multi-agent group chat scenarios. This helps the model understand:
 * - Its own identity within the group
 * - The group composition and other members
 * - Rules for handling system metadata
 *
 * The injector creates a system injection message before the first user message,
 * containing:
 * - Agent's identity (name, role, ID)
 * - Group info (name, member list)
 * - Important rules about system metadata handling
 *
 * @example
 * ```typescript
 * const injector = new GroupContextInjector({
 *   enabled: true,
 *   currentAgentId: 'agt_xxx',
 *   currentAgentName: 'Weather Expert',
 *   currentAgentRole: 'participant',
 *   groupTitle: 'Writing Team',
 *   systemPrompt: 'A collaborative writing team for creating articles',
 *   members: [
 *     { id: 'agt_xxx', name: 'Weather Expert', role: 'participant' },
 *     { id: 'agt_yyy', name: 'Supervisor', role: 'supervisor' },
 *   ],
 * });
 * ```
 */
export class GroupContextInjector extends BaseFirstUserContentProvider {
  readonly name = 'GroupContextInjector';

  constructor(
    private config: GroupContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(): string | null {
    // Skip if not enabled
    if (!this.config.enabled) {
      log('Group context injection disabled, skipping');
      return null;
    }

    const content = this.buildGroupContextBlock();
    log('Group context prepared for injection');

    return content;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    // Update metadata
    if (this.config.enabled) {
      result.metadata.groupContextInjected = true;
    }

    return result;
  }

  /**
   * Build the group context block
   * Uses template from @lobechat/prompts with direct variable replacement
   */
  private buildGroupContextBlock(): string {
    const {
      currentAgentId,
      currentAgentName,
      currentAgentRole,
      groupTitle,
      members,
      systemPrompt,
    } = this.config;

    // Use formatGroupMembers from @lobechat/prompts
    const membersText = members ? formatGroupMembers(members, currentAgentId) : '';

    // Direct variable replacement on template
    const groupContextContent = groupContextTemplate
      .replace('{{AGENT_NAME}}', currentAgentName || '')
      .replace('{{AGENT_ROLE}}', currentAgentRole || '')
      .replace('{{AGENT_ID}}', currentAgentId || '')
      .replace('{{GROUP_TITLE}}', groupTitle || '')
      .replace('{{SYSTEM_PROMPT}}', systemPrompt || '')
      .replace('{{GROUP_MEMBERS}}', membersText);

    return `<group_context>
${groupContextContent}
</group_context>`;
  }
}
