import { type SidebarGroup } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ContextMenuTrigger,
  cx,
  Flexbox,
  Icon,
  Spin,
  Text,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { HashIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import PrivateLockIcon from '@/components/PrivateLockIcon';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { useHomeStore } from '@/store/home';

import { useCreateMenuItems } from '../../../../hooks';
import { useAgentModal } from '../../ModalProvider';
import SessionList from '../List';
import Actions from './Actions';
import { useGroupDropdownMenu } from './useDropdownMenu';

const styles = stylex.create({ item: { paddingInlineStart: '14px' } });

const GroupItem = memo<SidebarGroup>(({ items, id, name, visibility }) => {
  const sectionTriggerStyle = useSectionTriggerStyle();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isUpdating = useHomeStore((s) => s.groupUpdatingId === id);
  // Public and private folders share one Agents section in a workspace.
  const isPrivateFolder = !!useActiveWorkspaceId() && visibility === 'private';

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
            <AccordionTrigger style={sectionTriggerStyle}>
              <Flexbox horizontal align="center" gap={6} style={{ overflow: 'hidden' }}>
                {groupIcon}
                <SectionTitle>{name}</SectionTitle>
                {/* Outside the ellipsis so a long name can't push it out of view. */}
                {isPrivateFolder && <PrivateLockIcon />}
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
          itemClassName={stylex.props(styles.item).className}
          visibility={visibility}
        />
      </AccordionPanel>
    </AccordionItem>
  );
});

export default GroupItem;
