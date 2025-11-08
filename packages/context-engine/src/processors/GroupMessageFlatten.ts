import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:GroupMessageFlattenProcessor');

/**
 * Group Message Flatten Processor
 * Responsible for flattening role=group messages into standard assistant + tool message sequences
 *
 * Group messages are created when assistant messages with tools are merged with their tool results.
 * This processor converts them back to a flat structure that AI models can understand.
 */
export class GroupMessageFlattenProcessor extends BaseProcessor {
  readonly name = 'GroupMessageFlattenProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    let groupMessagesFlattened = 0;
    let assistantMessagesCreated = 0;
    let toolMessagesCreated = 0;

    const newMessages: any[] = [];

    // Process each message
    for (const message of clonedContext.messages) {
      // Check if this is a group message with children field
      if (message.role === 'group' && message.children) {
        // If children array is empty, skip this message entirely (no content to flatten)
        if (message.children.length === 0) {
          continue;
        }

        processedCount++;
        groupMessagesFlattened++;

        log(`Flattening group message ${message.id} with ${message.children.length} children`);

        // Flatten each child
        for (const child of message.children) {
          // 1. Create assistant message from child
          const assistantMsg: any = {
            content: child.content || '',
            createdAt: message.createdAt,
            id: child.id,
            meta: message.meta,
            role: 'assistant',
            updatedAt: message.updatedAt,
          };

          // Add tools if present (excluding result, which will be separate tool messages)
          if (child.tools && child.tools.length > 0) {
            assistantMsg.tools = child.tools.map((tool: any) => ({
              apiName: tool.apiName,
              arguments: tool.arguments,
              id: tool.id,
              identifier: tool.identifier,
              type: tool.type,
            }));
          }

          // Add reasoning if present (for models that support reasoning)
          if (message.reasoning) {
            assistantMsg.reasoning = message.reasoning;
          }

          // Preserve other fields that might be needed
          if (message.parentId) assistantMsg.parentId = message.parentId;
          if (message.threadId) assistantMsg.threadId = message.threadId;
          if (message.groupId) assistantMsg.groupId = message.groupId;
          if (message.agentId) assistantMsg.agentId = message.agentId;
          if (message.targetId) assistantMsg.targetId = message.targetId;
          if (message.topicId) assistantMsg.topicId = message.topicId;

          newMessages.push(assistantMsg);
          assistantMessagesCreated++;

          log(`Created assistant message ${assistantMsg.id} from child`);

          // 2. Create tool messages for each tool that has a result
          if (child.tools) {
            for (const tool of child.tools) {
              if (tool.result) {
                const toolMsg: any = {
                  content: tool.result.content,
                  createdAt: message.createdAt,
                  id: tool.result.id,
                  meta: message.meta,
                  plugin: {
                    apiName: tool.apiName,
                    arguments: tool.arguments,
                    id: tool.id,
                    identifier: tool.identifier,
                    type: tool.type,
                  },
                  pluginError: tool.result.error || undefined,
                  pluginState: tool.result.state || undefined,
                  role: 'tool',
                  tool_call_id: tool.id,
                  updatedAt: message.updatedAt,
                };

                // Preserve parent message references
                if (message.parentId) toolMsg.parentId = message.parentId;
                if (message.threadId) toolMsg.threadId = message.threadId;
                if (message.groupId) toolMsg.groupId = message.groupId;
                if (message.topicId) toolMsg.topicId = message.topicId;

                newMessages.push(toolMsg);
                toolMessagesCreated++;

                log(`Created tool message ${toolMsg.id} for tool call ${tool.id}`);
              }
            }
          }
        }
      } else {
        // Non-group message, keep as-is
        newMessages.push(message);
      }
    }

    clonedContext.messages = newMessages;

    // Update metadata
    clonedContext.metadata.groupMessagesFlattenProcessed = processedCount;
    clonedContext.metadata.groupMessagesFlattened = groupMessagesFlattened;
    clonedContext.metadata.assistantMessagesCreated = assistantMessagesCreated;
    clonedContext.metadata.toolMessagesCreated = toolMessagesCreated;

    log(
      `Group message flatten processing completed: ${groupMessagesFlattened} groups flattened, ${assistantMessagesCreated} assistant messages created, ${toolMessagesCreated} tool messages created`,
    );

    return this.markAsExecuted(clonedContext);
  }
}
