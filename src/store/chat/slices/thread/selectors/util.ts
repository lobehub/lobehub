import { ThreadType, UIChatMessage } from '@lobechat/types';

export const genMessage = (
  messages: UIChatMessage[],
  startMessageId: string | undefined,
  threadMode?: ThreadType,
) => {
  if (!startMessageId) return [];

  // 如果是独立话题模式，则只显示话题开始消息
  if (threadMode === ThreadType.Standalone) {
    return messages.filter((m) => m.id === startMessageId);
  }

  // 如果是连续模式下，那么只显示话题开始消息和话题分割线
  const targetIndex = messages.findIndex((item) => item.id === startMessageId);

  if (targetIndex < 0) return [];

  return messages.slice(0, targetIndex + 1);
};
