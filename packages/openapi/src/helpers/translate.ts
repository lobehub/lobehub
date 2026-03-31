/**
 * Remove system context from message content, keeping only the user's original message
 */
export function removeSystemContext(content: string): string {
  if (!content) return content;

  // Match and remove the system context section
  const systemContextRegex = /<!-- 系统上下文[\S\s]*?<!-- 系统上下文结束 -->/g;

  const cleanContent = content.replaceAll(systemContextRegex, '').trim();

  // If the content is empty after removal, return the original (guard against unexpected cases)
  if (!cleanContent) {
    return content;
  }

  return cleanContent;
}
