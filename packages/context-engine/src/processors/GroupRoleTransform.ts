import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:GroupRoleTransformProcessor');

/**
 * Agent info for message sender identification
 */
export interface AgentInfo {
  name: string;
  role: 'supervisor' | 'participant';
}

/**
 * Configuration for GroupRoleTransformProcessor
 */
export interface GroupRoleTransformConfig {
  /**
   * Mapping from agentId to agent info
   * Used to look up agent name for each message
   */
  agentMap: Record<string, AgentInfo>;
  /**
   * The current agent ID that is responding
   * Messages from this agent will remain as assistant role
   */
  currentAgentId: string;
  /**
   * Custom function to generate tool name from identifier and apiName
   */
  genToolName?: (identifier: string, apiName: string) => string;
}

/**
 * Group Role Transform Processor
 *
 * Transforms messages from other agents to user role with speaker tags.
 * This prevents the model from imitating speaker tags in its output.
 *
 * From the model's perspective:
 * - role: assistant = "my" responses (current agent)
 * - role: user = external input (human users and other agents)
 *
 * Processing logic:
 * 1. Current agent's messages: Keep as assistant (no modifications)
 * 2. Other agents' assistant messages: Convert to user with speaker tag
 * 3. Other agents' tool messages: Convert to user with tool_result tag
 *
 * @example
 * ```typescript
 * const processor = new GroupRoleTransformProcessor({
 *   currentAgentId: 'travel-advisor',
 *   agentMap: {
 *     'weather-expert': { name: 'Weather Expert', role: 'participant' },
 *     'travel-advisor': { name: 'Travel Advisor', role: 'participant' },
 *     'supervisor': { name: 'Supervisor', role: 'supervisor' },
 *   }
 * });
 * ```
 */
export class GroupRoleTransformProcessor extends BaseProcessor {
  readonly name = 'GroupRoleTransformProcessor';

  constructor(
    private config: GroupRoleTransformConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if no currentAgentId or agentMap provided
    if (!this.config.currentAgentId || !this.config.agentMap) {
      log('No currentAgentId or agentMap provided, skipping processing');
      return this.markAsExecuted(clonedContext);
    }

    let assistantTransformed = 0;
    let toolTransformed = 0;

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      // Process assistant messages
      if (msg.role === 'assistant' && msg.agentId) {
        if (msg.agentId === this.config.currentAgentId) {
          // Current agent: keep as assistant, no modifications
          return msg;
        }

        // Other agent: transform to user with speaker tag
        const transformed = this.transformAssistantMessage(msg);
        if (transformed !== msg) {
          assistantTransformed++;
          log(`Transformed assistant message from agent: ${msg.agentId} to user`);
        }
        return transformed;
      }

      // Process tool messages
      if (msg.role === 'tool' && msg.agentId) {
        if (msg.agentId === this.config.currentAgentId) {
          // Current agent: keep as tool
          return msg;
        }

        // Other agent: transform to user with tool_result tag
        const transformed = this.transformToolMessage(msg);
        if (transformed !== msg) {
          toolTransformed++;
          log(`Transformed tool message from agent: ${msg.agentId} to user`);
        }
        return transformed;
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.groupRoleTransformProcessed = {
      assistantTransformed,
      toolTransformed,
    };

    log(
      `Group role transform completed: ${assistantTransformed} assistant messages, ${toolTransformed} tool messages transformed`,
    );

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Transform an assistant message from another agent to a user message
   */
  private transformAssistantMessage(msg: Message): Message {
    const agentInfo = this.config.agentMap[msg.agentId];
    if (!agentInfo) {
      // No agent info found, keep original
      return msg;
    }

    const agentName = agentInfo.name;
    let content = this.buildSpeakerTag(agentName);

    // Add original content
    const originalContent = this.getStringContent(msg.content);
    if (originalContent) {
      content += originalContent;
    }

    // Add tool_use section if message has tools
    if (msg.tools && msg.tools.length > 0) {
      content += this.buildToolUseSection(msg.tools);
    }

    return {
      ...msg,
      content,
      role: 'user',
      // Remove tool-related fields as they're now embedded in content
      tools: undefined,
    };
  }

  /**
   * Transform a tool result message from another agent to a user message
   */
  private transformToolMessage(msg: Message): Message {
    const agentInfo = this.config.agentMap[msg.agentId];
    if (!agentInfo) {
      // No agent info found, keep original
      return msg;
    }

    const agentName = agentInfo.name;
    const toolName = this.getToolName(msg.plugin);
    const toolCallId = msg.tool_call_id || 'unknown';
    const resultContent = this.getStringContent(msg.content);

    const content = `${this.buildSpeakerTag(agentName)}<tool_result id="${toolCallId}" name="${toolName}">
${resultContent}
</tool_result>`;

    return {
      ...msg,
      content,
      // Remove tool-related fields
      plugin: undefined,
      role: 'user',
      tool_call_id: undefined,
    };
  }

  /**
   * Build the speaker tag
   */
  private buildSpeakerTag(agentName: string): string {
    return `<speaker name="${agentName}" />\n`;
  }

  /**
   * Build the tool_use section for assistant messages with tools
   */
  private buildToolUseSection(tools: any[]): string {
    let section = '\n\n<tool_use>\n';

    for (const tool of tools) {
      const toolName = this.getToolName(tool);
      const toolId = tool.id || 'unknown';
      const args = tool.arguments || '';

      section += `<tool id="${toolId}" name="${toolName}">\n`;
      section += `${args}\n`;
      section += `</tool>\n`;
    }

    section += '</tool_use>';
    return section;
  }

  /**
   * Get tool name from tool object
   */
  private getToolName(tool: any): string {
    if (!tool) return 'unknown';

    const identifier = tool.identifier || '';
    const apiName = tool.apiName || '';

    if (this.config.genToolName) {
      return this.config.genToolName(identifier, apiName);
    }

    if (identifier && apiName) {
      return `${identifier}.${apiName}`;
    }

    return identifier || apiName || 'unknown';
  }

  /**
   * Extract string content from message content (handles both string and array formats)
   */
  private getStringContent(content: string | any[]): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      // Extract text from array content
      return content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text || '')
        .join('\n');
    }

    return '';
  }
}
