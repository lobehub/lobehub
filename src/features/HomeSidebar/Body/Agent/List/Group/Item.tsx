import { type SidebarGroup } from '@lobechat/types';
import { ContextMenuTrigger, Flexbox, Icon } from '@lobehub/ui';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  Spin,
  Text,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { HashIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo, useState } from 'react';

import { useHomeStore } from '@/store/home';

import { useCreateMenuItems } from '../../../../hooks';
import { useAgentModal } from '../../ModalProvider';
import SessionList from '../List';
import Actions from './Actions';
import { useGroupDropdownMenu } from './useDropdownMenu';

const styles = createStaticStyles(({ css }) => ({
  item: css`
    padding-inline-start: 14px;
  `,
}));

const GroupItem = memo<SidebarGroup>(({ items, id, name, visibility }) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isUpdating = useHomeStore((s) => s.groupUpdatingId === id);

  // Modal management
  const { openConfigGroupModal } = useAgentModal();

  // Create menu items
  const { isLoading } = useCreateMenuItems();

  const handleOpenConfigGroupModal = useCallback(() => {
    openConfigGroupModal(visibility);
  }, [openConfigGroupModal, visibility]);

  const dropdownMenu = useGroupDropdownMenu({
    anchor,
    id,
    isCustomGroup: true,
    name,
    openConfigGroupModal: handleOpenConfigGroupModal,
    visibility,
  });

  const groupIcon = useMemo(() => {
    if (isUpdating) {
      return <Spin size="small" style={{ opacity: 0.5 }} />;
    }
    return <Icon icon={HashIcon} style={{ opacity: 0.5 }} />;
  }, [isUpdating]);

  return (
    <AccordionItem disabled={isUpdating} key={id} value={id}>
      <ContextMenuTrigger items={dropdownMenu}>
        <div ref={setAnchor}>
          <AccordionHeader>
            <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
              <Flexbox horizontal align="center" gap={6} style={{ overflow: 'hidden' }}>
                {groupIcon}
                <Text ellipsis fontSize={12} style={{ flex: 1 }} type={'secondary'} weight={500}>
                  {name}
                </Text>
              </Flexbox>
            </AccordionTrigger>
            <div
              className={cx(
                'accordion-action',
                accordionStyles.action,
                accordionStyles.actionBorderless,
              )}
            >
              <Actions dropdownMenu={dropdownMenu} isLoading={isLoading} />
            </div>
          </AccordionHeader>
        </div>
      </ContextMenuTrigger>
      <AccordionPanel>
        <SessionList
          dataSource={items}
          groupId={id}
          itemClassName={styles.item}
          visibility={visibility}
        />
      </AccordionPanel>
    </AccordionItem>
  );
});

export default GroupItem;
