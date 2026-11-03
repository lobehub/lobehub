'use client';

import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useAgentContext } from '@/features/Conversation/useAgentContext';
import { useShareModal } from '@/features/ShareModal';
import { LazySharePopover as SharePopover } from '@/features/SharePopover/lazy';
import { usePermission } from '@/hooks/usePermission';
import HeaderSlot from '@/routes/(main)/agent/(chat)/_layout/HeaderSlot';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { useMenu } from './useMenu';

const HeaderActions = memo(() => {
  const { agentId, topicId } = useAgentContext();
  const workspaceId = useActiveWorkspaceId();
  const enableTopicLinkShare = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { allowed: canShare } = usePermission('edit_own_content');
  const { openShareModal } = useShareModal();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const sharePendingRef = useRef(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Inside a workspace the header ShareButton gives way to comments, so Share
  // moves into this menu; the personal header keeps its own button.
  const shareInMenu = !!workspaceId && !!topicId;

  const share = useMemo(
    () =>
      shareInMenu
        ? {
            disabled: !canShare,
            onClick: () => {
              if (!enableTopicLinkShare) {
                void openShareModal();
                return;
              }
              // The menu hands focus back to its trigger as it closes, which a
              // popover opened any earlier reads as focus-out and dismisses.
              sharePendingRef.current = true;
            },
          }
        : undefined,
    [canShare, enableTopicLinkShare, openShareModal, shareInMenu],
  );

  const { menuHeader, menuItems } = useMenu({ share });

  const handleMenuOpenChangeComplete = useCallback((open: boolean) => {
    if (open || !sharePendingRef.current) return;

    sharePendingRef.current = false;
    setShareOpen(true);
  }, []);

  return (
    <>
      <HeaderSlot.Outlet />
      <DropdownMenu
        header={menuHeader}
        items={menuItems}
        onOpenChangeComplete={handleMenuOpenChangeComplete}
      >
        <ActionIcon icon={MoreHorizontal} ref={triggerRef} size={'small'} />
      </DropdownMenu>
      {shareInMenu && enableTopicLinkShare && canShare && (
        <SharePopover
          agentId={agentId}
          anchor={triggerRef}
          open={shareOpen}
          placement={'bottomLeft'}
          onOpenChange={setShareOpen}
          onOpenModal={openShareModal}
        >
          <span hidden />
        </SharePopover>
      )}
    </>
  );
});

HeaderActions.displayName = 'HeaderActions';

export default HeaderActions;
