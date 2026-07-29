'use client';

import { AccordionItem, ActionIcon, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import React, { memo, type MouseEvent, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import { useCreateMenuItems } from '../../hooks';
import Actions from '../Agent/Actions';
import { useAgentModal } from '../Agent/ModalProvider';
import PrivateList from './List';
import { usePrivateActionsDropdownMenu } from './useDropdownMenu';

interface PrivateProps {
  itemKey: string;
}

// Top-level "Private" sidebar section, structurally mirroring the Agent
// accordion. Everything created from the `+` button is hard-pinned to
// `visibility: 'private'`, so users get a predictable bucket for personal
// work without ever having to think about visibility flags.
//
// Sidebar-level controls (manage groups, move up/down, customize sidebar)
// live in the "More" dropdown so private management stays consistent with
// the workspace-public Agent section.
const Private = memo<PrivateProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const { isRevalidating } = useFetchAgentList();

  const { openConfigGroupModal } = useAgentModal();

  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPlatformAgentMenuItem,
    isLoading,
  } = useCreateMenuItems();

  // Mirror the public Agent "+" menu so the create surface is consistent
  // across both buckets — heterogeneous and platform agents are hard-pinned
  // to private here. Session-group creation lives in the "More" dropdown.
  const addMenuItems = useMemo(() => {
    const heterogeneousItems = createHeterogeneousAgentMenuItems({ visibility: 'private' });
    const platformItem = createPlatformAgentMenuItem({ visibility: 'private' });

    return [
      createAgentMenuItem({ visibility: 'private' }),
      createGroupChatMenuItem({ visibility: 'private' }),
      ...(heterogeneousItems.length > 0
        ? [{ type: 'divider' as const }, ...heterogeneousItems]
        : []),
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPlatformAgentMenuItem,
  ]);

  const handleOpenConfigGroupModal = useCallback(() => {
    openConfigGroupModal('private');
  }, [openConfigGroupModal]);

  const dropdownMenu = usePrivateActionsDropdownMenu({
    openConfigGroupModal: handleOpenConfigGroupModal,
  });

  const navigate = useWorkspaceAwareNavigate();
  const handleViewAll = useCallback(
    (e: MouseEvent) => {
      // Stop the click from toggling the accordion header.
      e.stopPropagation();
      // Land the view-all page on the tab matching this section.
      navigate('/agents?tab=private');
    },
    [navigate],
  );

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      action={
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={ArrowRight}
            size={'small'}
            title={t('navPanel.viewAllAgents')}
            onClick={handleViewAll}
          />
          <Actions addMenuItems={addMenuItems} dropdownMenu={dropdownMenu} isLoading={isLoading} />
        </Flexbox>
      }
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('navPanel.privateAgents', { defaultValue: 'Private' })}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
    >
      <Suspense fallback={<SkeletonList rows={3} />}>
        <PrivateList />
      </Suspense>
    </AccordionItem>
  );
});

Private.displayName = 'Private';

export default Private;
