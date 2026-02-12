import { type SidebarGroup } from '@lobechat/types';
import { AccordionItem, ContextMenuTrigger, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { HashIcon, Loader2 } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';

import { useHomeStore } from '@/store/home';

import { useCreateMenuItems } from '../../../../hooks';
import { useAgentModal } from '../../ModalProvider';
import SessionList from '../List';
import Actions from './Actions';
import Editing from './Editing';
import { useGroupDropdownMenu } from './useDropdownMenu';

const styles = createStaticStyles(({ css }) => ({
  item: css`
    padding-inline-start: 14px;
  `,
}));

const GroupItem = memo<SidebarGroup>(({ items, id, name }) => {
  const [editing, isUpdating] = useHomeStore((s) => [
    s.groupRenamingId === id,
    s.groupUpdatingId === id,
  ]);

  // Modal management
  const { openConfigGroupModal } = useAgentModal();

  // Create menu items
  const { isLoading } = useCreateMenuItems();

  const toggleEditing = useCallback(
    (visible?: boolean) => {
      useHomeStore.getState().setGroupRenamingId(visible ? id : null);
    },
    [id],
  );

  const handleOpenConfigGroupModal = useCallback(() => {
    openConfigGroupModal();
  }, [openConfigGroupModal]);

  const dropdownMenu = useGroupDropdownMenu({
    id,
    isCustomGroup: true,
    openConfigGroupModal: handleOpenConfigGroupModal,
    toggleEditing,
  });

  const groupIcon = useMemo(() => {
    if (isUpdating) {
      return <Icon spin icon={Loader2} style={{ opacity: 0.5 }} />;
    }
    return <Icon icon={HashIcon} style={{ opacity: 0.5 }} />;
  }, [isUpdating]);

  return (
    <AccordionItem
      action={<Actions dropdownMenu={dropdownMenu} isLoading={isLoading} />}
      disabled={editing || isUpdating}
      itemKey={id}
      key={id}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" gap={6} style={{ overflow: 'hidden' }}>
          {groupIcon}
          <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
            {name}
          </Text>
        </Flexbox>
      }
    >
      <Editing id={id} name={name} toggleEditing={toggleEditing} />
      <SessionList dataSource={items} groupId={id} itemClassName={styles.item} />
    </AccordionItem>
  );
});

export default GroupItem;
