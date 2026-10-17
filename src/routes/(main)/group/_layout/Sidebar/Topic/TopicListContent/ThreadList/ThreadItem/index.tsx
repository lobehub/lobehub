import { cssVar, Icon } from '@lobehub/ui';
import { CornerDownRight } from 'lucide-react';
import { memo, useCallback } from 'react';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useChatStore } from '@/store/chat';

import { useThreadNavigation } from '../../../hooks/useThreadNavigation';
import Actions from './Actions';
import { useThreadItemDropdownMenu } from './useDropdownMenu';

export interface ThreadItemProps {
  id: string;
  index: number;
  isSubagent?: boolean;
  title: string;
}

const SUBAGENT_PADDING_INLINE_START = 32;

const ThreadItem = memo<ThreadItemProps>(({ title, id, isSubagent }) => {
  const activeThreadId = useChatStore((s) => s.activeThreadId);

  const { navigateToThread, isInAgentSubRoute } = useThreadNavigation();

  const handleClick = useCallback(() => {
    navigateToThread(id);
  }, [id, navigateToThread]);

  const dropdownMenu = useThreadItemDropdownMenu({
    id,
    title,
  });

  const active = id === activeThreadId;

  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        data-thread-id={id}
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
      />
    </>
  );
});

export default ThreadItem;
