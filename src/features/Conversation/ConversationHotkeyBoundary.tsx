'use client';

import { type PropsWithChildren } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';

import { useConversationHotkeyStore } from './hotkeyStore';

interface ConversationHotkeyBoundaryProps extends PropsWithChildren {
  conversationKey: string;
}

const ConversationHotkeyBoundary = memo<ConversationHotkeyBoundaryProps>(
  ({ children, conversationKey }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const activateIfNone = useConversationHotkeyStore((s) => s.activateIfNone);
    const setActiveConversationKey = useConversationHotkeyStore((s) => s.setActiveConversationKey);

    const activateCurrentConversation = useCallback(() => {
      setActiveConversationKey(conversationKey);
    }, [conversationKey, setActiveConversationKey]);

    const clearCurrentConversation = useCallback(() => {
      if (useConversationHotkeyStore.getState().activeConversationKey !== conversationKey) return;

      setActiveConversationKey(undefined);
    }, [conversationKey, setActiveConversationKey]);

    const handleBlurCapture = useCallback(() => {
      queueMicrotask(() => {
        const root = rootRef.current;
        const activeElement = document.activeElement;

        if (root && activeElement && root.contains(activeElement)) return;

        clearCurrentConversation();
      });
    }, [clearCurrentConversation]);

    useEffect(() => {
      const handleDocumentPointerDown = (event: PointerEvent) => {
        const root = rootRef.current;
        if (!root || root.contains(event.target as Node)) return;

        clearCurrentConversation();
      };

      document.addEventListener('pointerdown', handleDocumentPointerDown);

      return () => {
        document.removeEventListener('pointerdown', handleDocumentPointerDown);
      };
    }, [clearCurrentConversation]);

    useEffect(() => {
      // Atomically activate only if no other conversation is active
      activateIfNone(conversationKey);

      return () => {
        clearCurrentConversation();
      };
    }, [activateIfNone, clearCurrentConversation, conversationKey]);

    return (
      <div
        ref={rootRef}
        style={{ display: 'contents' }}
        onBlurCapture={handleBlurCapture}
        onFocusCapture={activateCurrentConversation}
        onPointerDownCapture={activateCurrentConversation}
      >
        {children}
      </div>
    );
  },
);

ConversationHotkeyBoundary.displayName = 'ConversationHotkeyBoundary';

export default ConversationHotkeyBoundary;
