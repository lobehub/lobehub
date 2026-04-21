import { Flexbox, Icon, Tag } from '@lobehub/ui';
import { TreeDownRightIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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

const ThreadItem = memo<ThreadItemProps>(({ title, id, isSubagent }) => {
  const { t } = useTranslation('chat');
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

  // Subagent threads (spawned by an external agent's subagent tool call)
  // only get a plain "Subagent" badge — the specific template name is
  // surfaced on the Thread header instead, where there's room for it.
  return (
    <>
      <NavItem
        actions={<Actions dropdownMenu={dropdownMenu} />}
        active={active && !isInAgentSubRoute}
        contextMenuItems={dropdownMenu}
        disabled={editing}
        icon={<Icon color={cssVar.colorTextDescription} icon={TreeDownRightIcon} size={'small'} />}
        title={
          isSubagent ? (
            <Flexbox horizontal align={'center'} flex={1} gap={6}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </span>
              <Tag
                size={'small'}
                style={{ color: cssVar.colorTextDescription, flexShrink: 0, fontSize: 10 }}
              >
                {t('thread.subagentBadge')}
              </Tag>
            </Flexbox>
          ) : (
            title
          )
        }
        onClick={handleClick}
      />
      <Editing id={id} title={title} toggleEditing={toggleEditing} />
    </>
  );
});

export default ThreadItem;
