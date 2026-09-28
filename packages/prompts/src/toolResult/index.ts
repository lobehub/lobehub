import {
  appendTextWindowNotice,
  sliceTextWindow,
  type TextWindow,
} from '@lobechat/prompts/textWindow';

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
 * Tool identifiers whose results must never be truncated or archived,
 * because they are themselves the read surface for archived content.
 */
export const ARCHIVE_BYPASS_IDENTIFIERS = new Set<string>(['lobe-agent-documents']);

/**
 * The leading window of an oversized tool result: whole lines up to `maxLength` characters, using
 * the shared text-window contract so archived results can be paged with the same line numbers.
 */
export const sliceToolResult = (content: string, maxLength?: number): TextWindow =>
  sliceTextWindow(content, { maxChars: maxLength ?? DEFAULT_TOOL_RESULT_MAX_LENGTH });

/**
 * Truncate tool result content if it exceeds the maximum length.
 * Keeps whole leading lines and appends the shared notice with the shown range and total size.
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

  return appendTextWindowNotice(sliceToolResult(content, limit));
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
