import { Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CornerDownRight } from 'lucide-react';
import { memo, useCallback } from 'react';

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
  title: string;
}

const SUBAGENT_PADDING_INLINE_START = 32;

const ThreadItem = memo<ThreadItemProps>(({ title, id, isSubagent }) => {
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

  const dropdownMenu = useThreadItemDropdownMenu({
    id,
    toggleEditing,
  });

  const active = id === activeThreadId;

  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        icon={<Icon color={cssVar.colorTextDescription} icon={CornerDownRight} size={'small'} />}
        style={isSubagent ? { paddingInlineStart: SUBAGENT_PADDING_INLINE_START } : undefined}
        title={title}
        onClick={handleClick}
      />
      <Editing id={id} title={title} toggleEditing={toggleEditing} />
    </>
  );
});

export default ThreadItem;
