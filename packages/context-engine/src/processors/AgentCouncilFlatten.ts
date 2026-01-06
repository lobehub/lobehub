import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:AgentCouncilFlattenProcessor');

/**
 * Agent Council Flatten Processor
 * Responsible for flattening role=agentCouncil messages into standard assistant + tool message sequences
 *
 * AgentCouncil messages are created when multiple agents respond in parallel (broadcast scenario).
 * This processor converts them back to a flat structure that AI models can understand.
 *
 * Structure:
 * - agentCouncil message has `members: Message[]` array
 * - Each member can be a regular assistant message or an assistantGroup message
 * - If member is assistantGroup, it needs further flattening (assistant + tool messages)
 */
export class AgentCouncilFlattenProcessor extends BaseProcessor {
  readonly name = 'AgentCouncilFlattenProcessor';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let processedCount = 0;
    let agentCouncilMessagesFlattened = 0;
    let assistantMessagesCreated = 0;
    let toolMessagesCreated = 0;

    const newMessages: any[] = [];

    // Process each message
    for (const message of clonedContext.messages) {
      // Check if this is an agentCouncil message with members field
      if (message.role === 'agentCouncil' && message.members) {
        // If members array is empty, skip this message entirely (no content to flatten)
        if (message.members.length === 0) {
          continue;
        }

        processedCount++;
        agentCouncilMessagesFlattened++;

        log(`Flattening agentCouncil message ${message.id} with ${message.members.length} members`);

        // Flatten each member
        for (const member of message.members) {
          // Check if member is an assistantGroup (needs further flattening)
          if (member.role === 'assistantGroup' && member.children) {
            // Flatten assistantGroup into assistant + tool messages
            const flattenedMessages = this.flattenAssistantGroup(member, message);
            newMessages.push(...flattenedMessages);
            assistantMessagesCreated += flattenedMessages.filter(
              (m: any) => m.role === 'assistant',
            ).length;
            toolMessagesCreated += flattenedMessages.filter((m: any) => m.role === 'tool').length;
          } else {
            // Regular assistant message - transform to assistant role
            const assistantMsg: any = {
              content: member.content || '',
              createdAt: member.createdAt || message.createdAt,
              id: member.id,
              meta: member.meta || message.meta,
              role: 'assistant',
              updatedAt: member.updatedAt || message.updatedAt,
            };

            // Preserve agent-related fields
            if (member.agentId) assistantMsg.agentId = member.agentId;
            if (member.model) assistantMsg.model = member.model;
            if (member.provider) assistantMsg.provider = member.provider;

            // Add tools if present
            if (member.tools && member.tools.length > 0) {
              assistantMsg.tools = member.tools.map((tool: any) => ({
                apiName: tool.apiName,
                arguments: tool.arguments,
                id: tool.id,
                identifier: tool.identifier,
                type: tool.type,
              }));
            }

            // Add reasoning if present
            if (member.reasoning) {
              assistantMsg.reasoning = member.reasoning;
            }

            // Add error if present
            if (member.error) {
              assistantMsg.error = member.error;
            }

            // Add imageList if present
            if (member.imageList && member.imageList.length > 0) {
              assistantMsg.imageList = member.imageList;
            }

            // Preserve parent/thread/group/topic IDs from the agentCouncil message
            if (message.extra?.parentMessageId)
              assistantMsg.parentId = message.extra.parentMessageId;
            if (member.parentId) assistantMsg.parentId = member.parentId;
            if (member.threadId) assistantMsg.threadId = member.threadId;
            if (member.groupId) assistantMsg.groupId = member.groupId;
            if (member.topicId) assistantMsg.topicId = member.topicId;

            newMessages.push(assistantMsg);
            assistantMessagesCreated++;

            log(`Created assistant message ${assistantMsg.id} from member`);

            // Create tool messages if member has tools with results
            if (member.tools) {
              for (const tool of member.tools) {
                if (tool.result) {
                  const toolMsg = this.createToolMessage(tool, member, message);
                  newMessages.push(toolMsg);
                  toolMessagesCreated++;
                  log(`Created tool message ${toolMsg.id} for tool call ${tool.id}`);
                }
              }
            }
          }
        }
      } else {
        // Non-agentCouncil message, keep as-is
        newMessages.push(message);
      }
    }

    clonedContext.messages = newMessages;

    // Update metadata
    clonedContext.metadata.agentCouncilFlattenProcessed = processedCount;
    clonedContext.metadata.agentCouncilMessagesFlattened = agentCouncilMessagesFlattened;
    clonedContext.metadata.agentCouncilAssistantMessagesCreated = assistantMessagesCreated;
    clonedContext.metadata.agentCouncilToolMessagesCreated = toolMessagesCreated;

    log(
      `AgentCouncil message flatten processing completed: ${agentCouncilMessagesFlattened} councils flattened, ${assistantMessagesCreated} assistant messages created, ${toolMessagesCreated} tool messages created`,
    );

    return this.markAsExecuted(clonedContext);
  }

  /**
   * Flatten an assistantGroup member into assistant + tool messages
   */
  private flattenAssistantGroup(groupMember: any, parentMessage: any): any[] {
    const result: any[] = [];

    if (!groupMember.children || groupMember.children.length === 0) {
      return result;
    }

    for (const child of groupMember.children) {
      // Create assistant message from child
      const assistantMsg: any = {
        content: child.content || '',
        createdAt: groupMember.createdAt || parentMessage.createdAt,
        id: child.id,
        meta: groupMember.meta || parentMessage.meta,
        role: 'assistant',
        updatedAt: groupMember.updatedAt || parentMessage.updatedAt,
      };

      // Preserve agent-related fields from group member
      if (groupMember.agentId) assistantMsg.agentId = groupMember.agentId;
      if (groupMember.model) assistantMsg.model = groupMember.model;
      if (groupMember.provider) assistantMsg.provider = groupMember.provider;

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

      // Add reasoning if present
      if (child.reasoning) {
        assistantMsg.reasoning = child.reasoning;
      }

      // Add error if present
      if (child.error) {
        assistantMsg.error = child.error;
      }

      // Add imageList if present
      if (child.imageList && child.imageList.length > 0) {
        assistantMsg.imageList = child.imageList;
      }

      // Preserve parent/thread/group/topic IDs
      if (parentMessage.extra?.parentMessageId)
        assistantMsg.parentId = parentMessage.extra.parentMessageId;
      if (groupMember.parentId) assistantMsg.parentId = groupMember.parentId;
      if (groupMember.threadId) assistantMsg.threadId = groupMember.threadId;
      if (groupMember.groupId) assistantMsg.groupId = groupMember.groupId;
      if (groupMember.topicId) assistantMsg.topicId = groupMember.topicId;

      result.push(assistantMsg);

      // Create tool messages for each tool that has a result
      if (child.tools) {
        for (const tool of child.tools) {
          if (tool.result) {
            const toolMsg = this.createToolMessage(tool, groupMember, parentMessage);
            result.push(toolMsg);
          }
        }
      }
    }

    return result;
  }

  /**
   * Create a tool message from tool data
   */
  private createToolMessage(tool: any, member: any, parentMessage: any): any {
    const toolMsg: any = {
      content: tool.result.content,
      createdAt: member.createdAt || parentMessage.createdAt,
      id: tool.result.id,
      meta: member.meta || parentMessage.meta,
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
      updatedAt: member.updatedAt || parentMessage.updatedAt,
    };

    // Preserve parent message references
    if (parentMessage.extra?.parentMessageId)
      toolMsg.parentId = parentMessage.extra.parentMessageId;
    if (member.parentId) toolMsg.parentId = member.parentId;
    if (member.threadId) toolMsg.threadId = member.threadId;
    if (member.groupId) toolMsg.groupId = member.groupId;
    if (member.topicId) toolMsg.topicId = member.topicId;

    return toolMsg;
  }
}
