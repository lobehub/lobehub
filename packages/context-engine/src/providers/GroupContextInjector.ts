import {
  type GroupContextMemberInfo,
  formatGroupMembers,
  groupContextTemplate,
} from '@lobechat/prompts';
import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
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
 * Responsible for injecting group context information into the system role
 * for multi-agent group chat scenarios. This helps the model understand:
 * - Its own identity within the group
 * - The group composition and other members
 * - Rules for handling system metadata
 *
 * The injector appends a GROUP CONTEXT block at the end of the system message,
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
export class GroupContextInjector extends BaseProvider {
  readonly name = 'GroupContextInjector';

  constructor(
    private config: GroupContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if not enabled or missing required config
    if (!this.config.enabled) {
      log('Group context injection disabled, skipping');
      return this.markAsExecuted(clonedContext);
    }

    // Find the system message to append to
    const systemMessageIndex = clonedContext.messages.findIndex((msg) => msg.role === 'system');

    if (systemMessageIndex === -1) {
      log('No system message found, skipping group context injection');
      return this.markAsExecuted(clonedContext);
    }

    const systemMessage = clonedContext.messages[systemMessageIndex];
    const groupContext = this.buildGroupContextBlock();

    // Append group context to system message content
    if (typeof systemMessage.content === 'string') {
      clonedContext.messages[systemMessageIndex] = {
        ...systemMessage,
        content: systemMessage.content + groupContext,
      };

      log('Group context injected into system message');
    }

    // Update metadata
    clonedContext.metadata.groupContextInjected = true;

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Build the group context block to append to system message
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

    return `

<group_context>
${groupContextContent}
</group_context>`;
  }
}
