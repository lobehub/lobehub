import { encode } from '@toon-format/toon';

/**
 * Maersy Toon 优化器
 * 用于将 LobeChat 的消息上下文压缩为 TOON 格式以节省 Token
 */
export const maersyToonTransform = (messages: any[]) => {
  // 只有 1 条消息时（刚开始对话）不需要压缩
  if (!messages || messages.length <= 1) return messages;

  // 提取历史记录（不含最后一条，因为模型需要对当前提问保持高敏感度）
  const history = messages.slice(0, -1);
  const currentMessage = messages[messages.length - 1];

  try {
    // 调用压缩算法
    const compressedHistory = encode(history);

    return [
      {
        role: 'system',
        content: 'System: Context compressed via MaersyToon to optimize tokens. Use internal logic to interpret.'
      },
      {
        role: 'user',
        content: `[MAERSY_TOON_CONTEXT]\n${compressedHistory}\n\n[CURRENT_QUERY]\n${currentMessage.content}`
      }
    ];
  } catch (error) {
    console.error('[MaersyToon] Encode Error:', error);
    // 如果压缩失败，返回原始消息，防止对话中断
    return messages;
  }
};