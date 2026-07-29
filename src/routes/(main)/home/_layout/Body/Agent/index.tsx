'use client';

import { AccordionItem, ActionIcon, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import React, { memo, type MouseEvent, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import { useCreateMenuItems } from '../../hooks';
import Actions from './Actions';
import List from './List';
import { useAgentModal } from './ModalProvider';
import { useAgentActionsDropdownMenu } from './useDropdownMenu';

interface AgentProps {
  itemKey: string;
}

const Agent = memo<AgentProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const { isRevalidating } = useFetchAgentList();
  // In workspace mode the section pairs with the "Private" bucket, so the
  // public/shared agents are labeled "Public" to make the contrast obvious.
  // Personal mode has no such duality — keep the existing "Agents" label.
  const activeWorkspaceId = useActiveWorkspaceId();
  const titleKey = activeWorkspaceId ? 'navPanel.publicAgents' : 'navPanel.agent';

  const { openConfigGroupModal } = useAgentModal();

  // Create menu items
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();

  const addMenuItems = useMemo(() => createTopLevelMenuItems(), [createTopLevelMenuItems]);

  const handleOpenConfigGroupModal = useCallback(() => {
    openConfigGroupModal();
  }, [openConfigGroupModal]);

  const dropdownMenu = useAgentActionsDropdownMenu({
    openConfigGroupModal: handleOpenConfigGroupModal,
  });

  const navigate = useWorkspaceAwareNavigate();
  const handleViewAll = useCallback(
    (e: MouseEvent) => {
      // Stop the click from toggling the accordion header.
      e.stopPropagation();
      navigate('/agents');
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
          {/* The flat view-all page adapts per mode: workspace gets the
              workspace/private segments + per-user pin + author column;
              personal mode gets the plain flat list. */}
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
            {t(titleKey)}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
    >
      <Suspense fallback={<SkeletonList rows={6} />}>
        <Flexbox gap={1} paddingBlock={1}>
          <List />
        </Flexbox>
      </Suspense>
    </AccordionItem>
  );
});

export default Agent;
