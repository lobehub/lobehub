import { Dropdown, Icon } from '@lobehub/ui';
import { TreeDownRightIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
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
  title: string;
}

const ThreadItem = memo<ThreadItemProps>(({ title, id }) => {
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
      <Dropdown
        menu={{
          items: dropdownMenu,
        }}
        trigger={['contextMenu']}
      >
        <NavItem
          actions={<Actions dropdownMenu={dropdownMenu} />}
          active={active && !isInAgentSubRoute}
          disabled={editing}
          icon={
            <Icon color={cssVar.colorTextDescription} icon={TreeDownRightIcon} size={'small'} />
          }
          onClick={handleClick}
          title={title}
        />
      </Dropdown>
      <Editing id={id} title={title} toggleEditing={toggleEditing} />
    </>
  );
});

export default ThreadItem;
