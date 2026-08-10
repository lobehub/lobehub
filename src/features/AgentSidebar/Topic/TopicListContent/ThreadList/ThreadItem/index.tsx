import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CornerDownRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback } from 'react';

import { startThreadDrag } from '@/features/ChatInput/InputEditor/ReferTopic/threadDragData';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';

import { useThreadNavigation } from '../../../hooks/useThreadNavigation';
import Actions from './Actions';
import Editing from './Editing';
import { useThreadItemDropdownMenu } from './useDropdownMenu';

export interface ThreadItemProps {
  id: string;
  index: number;
  isSubagent?: boolean;
  sourceMessageId?: string;
  title: string;
}

// Indent applied INSIDE the NavItem's Block (overrides default paddingInline=4
// on the start side), so the icon + title shift right by one icon-slot width
// while the row background/highlight stays full-width.
const SUBAGENT_PADDING_INLINE_START = 32;

const ThreadItem = memo<ThreadItemProps>(({ title, id, isSubagent, sourceMessageId }) => {
  const [editing, activeThreadId] = useChatStore((s) => [
    s.threadRenamingId === id,
    s.activeThreadId,
  ]);

  const { navigateToThread, isInAgentSubRoute } = useThreadNavigation();

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useChatStore.setState({ threadRenamingId: visible ? id : '' });
    },
    [id],
  );

  const handleClick = useCallback(() => {
    if (editing) return;
    navigateToThread(id);
  }, [editing, id, navigateToThread]);

  const handleDragStart = useCallback(
    (event: DragEvent) => {
      startThreadDrag(event, { sourceMessageId, threadId: id, threadTitle: title });
    },
    [id, title, sourceMessageId],
  );

  const dropdownMenu = useThreadItemDropdownMenu({
    id,
    sourceMessageId,
    toggleEditing,
  });

  const active = id === activeThreadId;

  return (
    <>
      <NavItem
        draggable
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        data-thread-id={id}
        disabled={editing}
        icon={<Icon color={cssVar.colorTextDescription} icon={CornerDownRight} size={'small'} />}
        // The capped ThreadList is a flex column, so rows shrink to fit its
        // max-height instead of overflowing — the scroll never engages. Pin the
        // row min-height to the NavItem height (36) to force overflow → scroll.
        title={title}
        style={{
          minHeight: 36,
          ...(isSubagent && { paddingInlineStart: SUBAGENT_PADDING_INLINE_START }),
        }}
        onClick={handleClick}
        onDragStart={handleDragStart}
      />
      <Editing id={id} title={title} toggleEditing={toggleEditing} />
    </>
  );
});

export default ThreadItem;
