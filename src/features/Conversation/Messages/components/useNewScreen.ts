import { useEffect, useState } from 'react';

/**
 * Header + avatar + padding 等固定元素的高度
 */
const FIXED_OFFSET = 100;

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

  useEffect(() => {
    if (!isLatestItem || !creating) {
      setMinHeight(undefined);
      return;
    }

    // 通过 data-message-id 找到当前消息元素
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    // 找到 VList item 容器 (有 data-index 属性)
    const currentWrapper = messageEl?.closest('[data-index]');
    // 获取前一个 VList item
    const prevWrapper = currentWrapper?.previousElementSibling;
    // 获取前一个消息的 .message-wrapper
    const prevMessageEl = prevWrapper?.querySelector('.message-wrapper');

    if (prevMessageEl) {
      const prevHeight = prevMessageEl.getBoundingClientRect().height;
      setMinHeight(`calc(100dvh - ${prevHeight + FIXED_OFFSET}px)`);
    } else {
      // fallback: 使用默认值
      setMinHeight(`calc(100dvh - ${DEFAULT_USER_MESSAGE_HEIGHT + FIXED_OFFSET}px)`);
    }
  }, [isLatestItem, creating, messageId]);

  return { minHeight };
};
