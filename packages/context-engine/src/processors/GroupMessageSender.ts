import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { Message, PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:GroupMessageSenderProcessor');

/**
 * Agent info for message sender identification
 */
export interface AgentInfo {
  name: string;
  role: 'supervisor' | 'participant';
}

/**
 * Configuration for GroupMessageSenderProcessor
 */
export interface GroupMessageSenderConfig {
  /**
   * Mapping from agentId to agent info
   * Used to look up agent name and role for each message
   */
  agentMap: Record<string, AgentInfo>;
}

/**
 * Group Message Sender Processor
 *
 * Responsible for injecting sender identity information into assistant messages
 * in group chat scenarios. This helps the model understand which agent sent
 * each message in a multi-agent conversation.
 *
 * The processor appends a system context block at the end of each assistant
 * message that has an agentId, containing:
 * - Agent name
 * - Agent role (supervisor or agent)
 * - Agent ID (with instruction not to expose it in responses)
 *
 * @example
 * ```typescript
 * const processor = new GroupMessageSenderProcessor({
 *   agentMap: {
 *     'agt_xxx': { name: 'Weather Expert', role: 'agent' },
 *     'agt_yyy': { name: 'Supervisor', role: 'supervisor' },
 *   }
 * });
 * ```
 */
export class GroupMessageSenderProcessor extends BaseProcessor {
  readonly name = 'GroupMessageSenderProcessor';

  constructor(
    private config: GroupMessageSenderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // Skip if no agentMap provided
    if (!this.config.agentMap || Object.keys(this.config.agentMap).length === 0) {
      log('No agentMap provided, skipping processing');
      return this.markAsExecuted(clonedContext);
    }

    let processedCount = 0;

    clonedContext.messages = clonedContext.messages.map((msg: Message) => {
      // Only process assistant messages with agentId
      if (msg.role === 'assistant' && msg.agentId) {
        const agentInfo = this.config.agentMap[msg.agentId];

        if (agentInfo) {
          // Build the sender tag
          const senderTag = this.buildSenderContext(msg.agentId, agentInfo);

          // Prepend to message content (at the beginning)
          if (typeof msg.content === 'string') {
            processedCount++;
            log(
              `Injecting sender info for message from agent: ${agentInfo.name} (${agentInfo.role})`,
            );

            return {
              ...msg,
              content: senderTag + msg.content,
            };
          }
          // Handle array content (multimodal messages)
          else if (Array.isArray(msg.content)) {
            const firstTextIndex = msg.content.findIndex((part: any) => part.type === 'text');

            if (firstTextIndex !== -1) {
              processedCount++;
              log(
                `Injecting sender info for multimodal message from agent: ${agentInfo.name} (${agentInfo.role})`,
              );

              const newContent = [...msg.content];
              newContent[firstTextIndex] = {
                ...newContent[firstTextIndex],
                text: senderTag + newContent[firstTextIndex].text,
              };

              return {
                ...msg,
                content: newContent,
              };
            }
          }
        }
      }

      return msg;
    });

    // Update metadata
    clonedContext.metadata.groupMessageSenderProcessed = processedCount;

    log(`Group message sender processing completed: ${processedCount} messages processed`);

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Build the sender tag to prepend to assistant messages.
   *
   * Uses a self-closing XML tag at the beginning:
   * - Placed at start so model sees "who is speaking" before the content
   * - Self-closing tag is less likely to be reproduced as it's not a "wrapper"
   */
  private buildSenderContext(_agentId: string, agentInfo: AgentInfo): string {
    return `<speaker name="${agentInfo.name}" />\n`;
  }
}
