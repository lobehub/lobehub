'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  ContextMenuTrigger,
  cx,
  Flexbox,
  Spin,
  Text,
} from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import React, { memo, type MouseEvent, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentLabels } from '@/hooks/useFetchAgentLabels';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';

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
  // Keep the label registry warm so the per-item "Labels" submenu opens populated.
  useFetchAgentLabels();
  // One "Agents" section in both modes. In a workspace it lists shared and
  // private rows together (private ones carry a lock icon).
  const activeWorkspaceId = useActiveWorkspaceId();

  const { openConfigGroupModal } = useAgentModal();

  // Create menu items
  const {
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
    createTopLevelMenuItems,
    isLoading,
  } = useCreateMenuItems();
  const { allowed: canCreatePublic } = usePermission('create_content');

  const addMenuItems = useMemo(() => {
    if (!activeWorkspaceId) return createTopLevelMenuItems();

    // Workspace: new agents start private (the safe default the former
    // Private section used); a workspace agent is one explicit entry away.
    const connectItem = createConnectAgentMenuItem({ visibility: 'private' });
    const workspaceAgentItem = canCreatePublic
      ? createAgentMenuItem({ visibility: 'public' })
      : undefined;

    return [
      createAgentMenuItem({ visibility: 'private' }),
      ...(workspaceAgentItem
        ? [
            {
              ...workspaceAgentItem,
              key: 'newWorkspaceAgent',
              label: t('navPanel.createWorkspaceAgent'),
            },
          ]
        : []),
      createGroupChatMenuItem({ visibility: 'private' }),
      ...(connectItem ? [{ type: 'divider' as const }, connectItem] : []),
      { type: 'divider' as const },
      createAgentListMenuItem(),
      createMarketAgentMenuItem(),
    ];
  }, [
    activeWorkspaceId,
    canCreatePublic,
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
    createTopLevelMenuItems,
    t,
  ]);

  const handleOpenConfigGroupModal = useCallback(
    (scope?: 'private' | 'public') => {
      openConfigGroupModal(scope);
    },
    [openConfigGroupModal],
  );

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
    <AccordionItem value={itemKey}>
      <ContextMenuTrigger items={dropdownMenu}>
        <AccordionHeader>
          <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
            <Flexbox horizontal align="center" gap={4}>
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('navPanel.agent')}
              </Text>
              {isRevalidating && <Spin size="small" variant="network" />}
            </Flexbox>
          </AccordionTrigger>
          <Flexbox
            horizontal
            align="center"
            gap={2}
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            {/* The flat view-all page adapts per mode: workspace gets the
                workspace/private segments + per-user pin + author column;
                personal mode gets the plain flat list. */}
            <ActionIcon
              icon={ArrowRight}
              size={'small'}
              title={t('navPanel.viewAllAgents')}
              onClick={handleViewAll}
            />
            <Actions
              addMenuItems={addMenuItems}
              dropdownMenu={dropdownMenu}
              isLoading={isLoading}
            />
          </Flexbox>
        </AccordionHeader>
      </ContextMenuTrigger>
      <AccordionPanel>
        <Suspense fallback={<SkeletonList rows={6} />}>
          <Flexbox gap={1} paddingBlock={1}>
            <List />
          </Flexbox>
        </Suspense>
      </AccordionPanel>
    </AccordionItem>
  );
});

export default Agent;
