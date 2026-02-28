/**
 * 从消息内容中移除系统上下文，只保留用户的原始消息
 */
export function removeSystemContext(content: string): string {
  if (!content) return content;

  // 匹配并移除系统上下文部分
  const systemContextRegex = /<!-- 系统上下文[\S\s]*?<!-- 系统上下文结束 -->/g;

  let cleanContent = content.replaceAll(systemContextRegex, '').trim();

  // 如果移除后内容为空，返回原内容（防止意外情况）
  if (!cleanContent) {
    return content;
  }

  return cleanContent;
}
