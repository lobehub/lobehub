import type { UIChatMessage } from '@lobechat/types';

/**
 * Extract content string from a UIChatMessage, handling virtual message types
 * Recursively processes nested structures (children, tasks, members, columns)
 *
 * Used for token counting in:
 * - UI TokenTag display
 * - History compression threshold calculation
 * - Compression result token counting
 *
 * @param message - Message to extract content from
 * @returns Concatenated content string for token estimation
 */
export const extractMessageContent = (message: UIChatMessage): string => {
  const role = message.role;

  // Standard messages: use content directly
  if (
    role === 'user' ||
    role === 'assistant' ||
    role === 'system' ||
    role === 'tool' ||
    role === 'task'
  ) {
    let content = message.content || '';
    // Include reasoning content for accurate token estimation
    if (message.reasoning?.content) {
      content += message.reasoning.content;
    }
    // Include RAG query content
    if (message.ragQuery) {
      content += message.ragQuery;
    }
    if (message.ragRawQuery) {
      content += message.ragRawQuery;
    }
    // Include search/grounding content
    if (message.search) {
      if (message.search.searchQueries?.length) {
        content += message.search.searchQueries.join('');
      }
      if (message.search.citations?.length) {
        content += message.search.citations.map((c) => c.title || '').join('');
      }
    }
    return content;
  }

  // assistantGroup / supervisor: extract from children array
  if (role === 'assistantGroup' || role === 'supervisor') {
    if (message.children?.length) {
      return message.children
        .map((block) => {
          let blockContent = block.content || '';
          // Include reasoning content
          if (block.reasoning?.content) {
            blockContent += block.reasoning.content;
          }
          // Include tool calls and results (part of conversation context)
          if (block.tools?.length) {
            block.tools.forEach((tool) => {
              // Tool call arguments (model generated JSON)
              if (tool.arguments) {
                blockContent += tool.arguments;
              }
              // Tool result content
              if (tool.result?.content) {
                blockContent += tool.result.content;
              }
            });
          }
          return blockContent;
        })
        .join('');
    }
    return message.content || '';
  }

  // tasks / groupTasks: extract from tasks array (recursive)
  if (role === 'tasks' || role === 'groupTasks') {
    if (message.tasks?.length) {
      return message.tasks.map(extractMessageContent).join('');
    }
    return '';
  }

  // agentCouncil: extract from members array (recursive)
  if (role === 'agentCouncil') {
    if (message.members?.length) {
      return message.members.map(extractMessageContent).join('');
    }
    return '';
  }

  // compare / compareGroup: extract from columns array (recursive)
  // Note: FlatListBuilder outputs 'compare', but type defines 'compareGroup'
  if (role === 'compare' || role === 'compareGroup') {
    const columns = (message as any).columns as UIChatMessage[][] | undefined;
    if (columns?.length) {
      return columns.flat().map(extractMessageContent).join('');
    }
    return '';
  }

  // compressedGroup: only return summary content
  // Note: compressedMessages/pinnedMessages are UI snapshot metadata, not sent to model.
  // The context pipeline (CompressedGroupRoleTransform) only uses the summary content.
  if (role === 'compressedGroup') {
    return message.content || '';
  }

  // Fallback for unknown types
  return message.content || '';
};
