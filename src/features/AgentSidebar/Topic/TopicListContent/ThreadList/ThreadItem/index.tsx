import { GroupBotIcon } from '@lobehub/ui/icons';
import { CornerDownRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback } from 'react';

import { startThreadDrag } from '@/features/ChatInput/InputEditor/ReferTopic/threadDragData';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import Actions from './Actions';
import { isThreadRowActive } from './active';
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
  // This row opens its thread in the Portal, so its "current" state is the
  // portal's thread — see `isThreadRowActive` for the conversation fallback.
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

  const active = isThreadRowActive({ activeThreadId, portalThreadId, threadId: id });

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
