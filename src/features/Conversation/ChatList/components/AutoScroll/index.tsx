'use client';

import { memo, useEffect } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
  virtuaListSelectors,
} from '../../../store';
import BackBottom from '../BackBottom';
import { AT_BOTTOM_THRESHOLD } from './DebugInspector';

const AutoScroll = memo(() => {
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const isScrolling = useConversationStore(virtuaListSelectors.isScrolling);
  const isGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const scrollToBottom = useConversationStore((s) => s.scrollToBottom);
  const dbMessages = useConversationStore(dataSelectors.dbMessages);

  const shouldAutoScroll = atBottom && isGenerating && !isScrolling;

  useEffect(() => {
    console.log('[AutoScroll] effect 执行', { dbMsgLen: dbMessages.length, shouldAutoScroll });
    if (shouldAutoScroll) {
      console.log('[AutoScroll] ✅ 调用 scrollToBottom');
      scrollToBottom(false);
    }
  }, [shouldAutoScroll, scrollToBottom, dbMessages.length]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Threshold 区域顶部边界线 */}
      <div
        style={{
          background: atBottom ? '#22c55e' : '#ef4444',
          height: 2,
          left: 0,
          opacity: 0.5,
          pointerEvents: 'none',
          position: 'absolute',
          right: 0,
          top: -AT_BOTTOM_THRESHOLD,
        }}
      />

      {/* Threshold 区域 mask - 显示在指示线上方 */}
      <div
        style={{
          background: atBottom
            ? 'linear-gradient(to top, rgba(34, 197, 94, 0.15), transparent)'
            : 'linear-gradient(to top, rgba(239, 68, 68, 0.1), transparent)',
          height: AT_BOTTOM_THRESHOLD,
          left: 0,
          pointerEvents: 'none',
          position: 'absolute',
          right: 0,
          top: -AT_BOTTOM_THRESHOLD,
        }}
      />

      {/* AutoScroll 位置指示线（底部） */}
      <div
        style={{
          background: atBottom ? '#22c55e' : '#ef4444',
          height: 2,
          position: 'relative',
          width: '100%',
        }}
      />

      <BackBottom onScrollToBottom={() => scrollToBottom(true)} visible={!atBottom} />
    </div>
  );
});

AutoScroll.displayName = 'ConversationAutoScroll';

export default AutoScroll;
