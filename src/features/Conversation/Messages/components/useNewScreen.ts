import debug from 'debug';
import { useEffect, useState } from 'react';

import { useConversationStore } from '../../store';

const log = debug('lobe-render:Conversation:newScreen');

/**
 * 额外的 padding（如果需要的话）
 */
const EXTRA_PADDING = 0;

/**
 * 默认的 userMessage 高度（fallback）
 */
const DEFAULT_USER_MESSAGE_HEIGHT = 200;

export const useNewScreen = ({
  isLatestItem,
  creating,
  messageId,
}: {
  creating?: boolean;
  isLatestItem?: boolean;
  messageId: string;
}) => {
  const [minHeight, setMinHeight] = useState<string | undefined>(undefined);
  const virtuaScrollMethods = useConversationStore((s) => s.virtuaScrollMethods);

  useEffect(() => {
    // 不再是最后一条消息时，清除 minHeight
    if (!isLatestItem) {
      setMinHeight(undefined);
      return;
    }

    // 只在 creating 时计算并设置 minHeight，creating 结束后保留
    if (!creating) {
      return;
    }

    // 通过 data-message-id 找到当前消息元素
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    // 找到 VList item 容器 (有 data-index 属性)
    const currentWrapper = messageEl?.closest('[data-index]') as HTMLElement | null;
    // 获取当前 index
    const currentIndex = currentWrapper?.dataset.index;

    // 通过 data-index 找到前一个 VList item（避免虚拟滚动导致 sibling 不存在）
    const prevIndex = currentIndex ? Number(currentIndex) - 1 : -1;
    const prevWrapper =
      prevIndex >= 0 ? document.querySelector(`[data-index="${prevIndex}"]`) : null;
    // 获取前一个消息的 .message-wrapper
    const prevMessageEl = prevWrapper?.querySelector('.message-wrapper');

    // 从 VList 获取真实的 viewport 高度
    const viewportHeight = virtuaScrollMethods?.getViewportSize?.() || window.innerHeight;

    // 获取当前 assistant message 的高度
    const currentMessageEl = currentWrapper?.querySelector('.message-wrapper');
    const currentHeight = currentMessageEl?.getBoundingClientRect().height || 0;

    if (prevMessageEl) {
      const prevHeight = prevMessageEl.getBoundingClientRect().height;

      // 期望：userMessage 在顶部，所以 assistantMinHeight = viewportHeight - userMessageHeight
      const calculatedHeight = viewportHeight - prevHeight - EXTRA_PADDING;

      log(
        '计算 minHeight: messageId=%s, currentIndex=%s, prevIndex=%d',
        messageId,
        currentIndex,
        prevIndex,
      );
      log(
        'viewportHeight=%d, prevHeight=%d, currentHeight=%d',
        viewportHeight,
        prevHeight,
        currentHeight,
      );
      log('calculatedHeight=%d (viewport - prev - padding)', calculatedHeight);

      // 如果计算出的高度小于等于 0，则不需要设置 minHeight
      setMinHeight(calculatedHeight > 0 ? `${calculatedHeight}px` : undefined);
    } else {
      // fallback: 使用默认值
      const fallbackHeight = viewportHeight - DEFAULT_USER_MESSAGE_HEIGHT - EXTRA_PADDING;
      log(
        'fallback minHeight: messageId=%s, viewportHeight=%d, fallbackHeight=%d',
        messageId,
        viewportHeight,
        fallbackHeight,
      );
      // 如果计算出的高度小于等于 0，则不需要设置 minHeight
      setMinHeight(fallbackHeight > 0 ? `${fallbackHeight}px` : undefined);
    }
  }, [isLatestItem, creating, messageId, virtuaScrollMethods]);

  return { minHeight };
};
