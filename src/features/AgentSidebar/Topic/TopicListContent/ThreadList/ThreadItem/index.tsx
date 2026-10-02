import { GroupBotIcon } from '@lobehub/ui/icons';
import { CornerDownRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback } from 'react';

import { startThreadDrag } from '@/features/ChatInput/InputEditor/ReferTopic/threadDragData';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import { useThreadItemDropdownMenu } from './useDropdownMenu';

export interface ThreadItemProps {
  id: string;
  index: number;
  isSubagent?: boolean;
  sourceMessageId?: string;
  title: string;
}

const ThreadItem = memo<ThreadItemProps>(({ title, id, isSubagent, sourceMessageId }) => {
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  // This row opens its thread in the Portal instead of switching the
  // conversation, so the row is "current" when its thread is what the portal
  // shows — with the active conversation as a fallback.
  const portalThreadId = useChatStore((s) => portalThreadSelectors.portalCurrentThread(s)?.id);
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);

  const handleClick = useCallback(() => {
    openThreadInPortal(id, sourceMessageId);
  }, [id, openThreadInPortal, sourceMessageId]);

  const handleDragStart = useCallback(
    (event: DragEvent) => {
      startThreadDrag(event, { sourceMessageId, threadId: id, threadTitle: title });
    },
    [id, title, sourceMessageId],
  );

  const dropdownMenu = useThreadItemDropdownMenu({
    id,
    sourceMessageId,
    title,
  });

  const active = id === portalThreadId || id === activeThreadId;

  return (
    <NavItem
      draggable
      actions={<Actions dropdownMenu={dropdownMenu} />}
      active={active}
      contextMenuItems={dropdownMenu}
      data-thread-id={id}
      icon={isSubagent ? GroupBotIcon : CornerDownRight}
      iconSize={16}
      // The capped ThreadList is a flex column, so rows shrink to fit its
      // max-height instead of overflowing — the scroll never engages. Pin the
      // row min-height to the NavItem height (36) to force overflow → scroll.
      style={{ minHeight: 36 }}
      title={title}
      onClick={handleClick}
      onDragStart={handleDragStart}
    />
  );
});

export default ThreadItem;
