/**
 * Shared utility for truncating tool execution results
 * Used by both frontend tRPC routers and backend tool execution service
 */

/**
 * Default maximum length for tool execution result content (in characters)
 * This prevents context overflow when sending results back to LLM
 */
export const DEFAULT_TOOL_RESULT_MAX_LENGTH = 25_000;

/**
 * Truncate tool result content if it exceeds the maximum length
 * Adds a truncation notice to inform the LLM that content was cut off
 *
 * @param content - The tool result content to truncate
 * @param maxLength - Maximum allowed length (uses default if not provided)
 * @returns Truncated content with notice if needed, or original content if within limit
 */
export function truncateToolResult(content: string, maxLength?: number): string {
  const limit = maxLength ?? DEFAULT_TOOL_RESULT_MAX_LENGTH;

  if (!content || content.length <= limit) {
    return content;
  }

  const truncated = content.slice(0, limit);
  const remainingChars = content.length - limit;

  // Add truncation notice
  const notice = `\n\n[Content truncated: ${remainingChars.toLocaleString()} characters omitted to prevent context overflow. Original length: ${content.length.toLocaleString()} characters]`;

  return truncated + notice;
}

/**
 * Truncate tool result with state object (for MCP/Cloud MCP tools)
 * Truncates the content field while preserving state structure
 */
export function truncateToolResultWithState<T extends { content: string; state?: any }>(
  result: T,
  maxLength?: number,
): T {
  return {
    ...result,
    content: truncateToolResult(result.content, maxLength),
  };
}
