import { ActionIcon, DropdownMenu, Flexbox, Tooltip } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { usePermission } from '@/hooks/usePermission';

import { useCreateMenuItems } from '../../hooks';

const AddButton = memo(() => {
  const { t: tChat } = useTranslation('chat');
  const { allowed: canCreate, reason } = usePermission('create_content');

  // Create menu items
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPageMenuItem,
    createPlatformAgentMenuItem,
    openCreateModal,
    isMutatingAgent,
    isCreatingGroup,
  } = useCreateMenuItems();

  const handleMainIconClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!canCreate) return;
      openCreateModal?.('agent');
    },
    [canCreate, openCreateModal],
  );

  const dropdownItems = useMemo(() => {
    const heterogeneousItems = createHeterogeneousAgentMenuItems();
    const platformItem = createPlatformAgentMenuItem();

    return [
      createAgentMenuItem(),
      createGroupChatMenuItem(),
      createPageMenuItem(),
      ...(heterogeneousItems.length > 0
        ? [{ type: 'divider' as const }, ...heterogeneousItems]
        : []),
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPageMenuItem,
    createPlatformAgentMenuItem,
  ]);

  // When viewer (no create_content): keep the icons visible per UX rule
  // (disabled-not-hidden), but the click handler short-circuits and the
  // dropdown is hidden (it would let users bypass the gate). Tooltip
  // surfaces the missing-permission reason.
  const mainIcon = (
    <ActionIcon
      disabled={!canCreate}
      icon={CreateBotIcon}
      loading={isMutatingAgent || isCreatingGroup}
      size={DESKTOP_HEADER_ICON_SIZE}
      title={canCreate ? tChat('newAgent') : undefined}
      onClick={handleMainIconClick}
    />
  );

  return (
    <Flexbox horizontal>
      {canCreate ? mainIcon : <Tooltip title={reason}>{mainIcon}</Tooltip>}
      {canCreate && (
        <DropdownMenu items={dropdownItems}>
          <ActionIcon
            color={cssVar.colorTextQuaternary}
            icon={ChevronDownIcon}
            size={{ blockSize: 32, size: 14 }}
            style={{
              width: 16,
            }}
          />
        </DropdownMenu>
      )}
    </Flexbox>
  );
});

export default AddButton;
