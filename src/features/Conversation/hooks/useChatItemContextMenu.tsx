import { type ActionIconGroupEvent } from '@lobehub/ui';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { MSG_CONTENT_CLASSNAME } from '@/features/Conversation/ChatItem/components/MessageContent';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

interface ContextMenuState {
  position: { x: number; y: number };
  selectedText?: string;
  visible: boolean;
}

interface UseChatItemContextMenuProps {
  editing?: boolean;
  id: string;
  onActionClick: (action: ActionIconGroupEvent) => void;
}

export const useChatItemContextMenu = ({
  onActionClick,
  editing,
}: Omit<UseChatItemContextMenuProps, 'id'>) => {
  const contextMenuMode = useUserStore(userGeneralSettingsSelectors.contextMenuMode);

  const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
    position: { x: 0, y: 0 },
    visible: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Don't show context menu if disabled in settings
      if (contextMenuMode === 'disabled') {
        return;
      }

      // Don't show context menu in editing mode
      if (editing) {
        return;
      }

      // Check if the clicked element or its parents have an id containing "msg_"
      let target = event.target as HTMLElement;
      let hasMessageId = false;

      while (target && target !== document.body) {
        if (target.className.includes(MSG_CONTENT_CLASSNAME)) {
          hasMessageId = true;
          break;
        }
        target = target.parentElement as HTMLElement;
      }

      if (!hasMessageId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // Get selected text
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() || '';

      setContextMenuState({
        position: { x: event.clientX, y: event.clientY },
        selectedText,
        visible: true,
      });
    },
    [contextMenuMode, editing],
  );

  const hideContextMenu = useCallback(() => {
    setContextMenuState((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleMenuClick = useCallback(
    (action: ActionIconGroupEvent) => {
      if (action.key === 'quote' && contextMenuState.selectedText) {
        // Handle quote action - this will be integrated with ChatInput
        onActionClick({
          ...action,
          selectedText: contextMenuState.selectedText,
        } as ActionIconGroupEvent & { selectedText: string });
      } else {
        onActionClick(action);
      }
      hideContextMenu();
    },
    [contextMenuState.selectedText, onActionClick, hideContextMenu],
  );

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenuState.visible) {
        hideContextMenu();
      }
    };

    const handleScroll = (event: Event) => {
      if (contextMenuState.visible) {
        // Check if the scroll event is from a dropdown sub-menu
        const target = event.target as HTMLElement;
        if (target && target.classList && target.classList.contains('ant-dropdown-menu-sub')) {
          return; // Don't hide the context menu when scrolling within sub-menu
        }
        hideContextMenu();
      }
    };

    if (contextMenuState.visible) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('scroll', handleScroll, true);

      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [contextMenuState.visible, hideContextMenu]);

  return {
    containerRef,
    contextMenuMode,
    contextMenuState,
    handleContextMenu,
    handleMenuClick,
    hideContextMenu,
  };
};
