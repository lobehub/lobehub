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
} from '@lobehub/ui';
import { ArrowRight } from 'lucide-react';
import React, { memo, type MouseEvent, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useFetchAgentLabels } from '@/hooks/useFetchAgentLabels';
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
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { isRevalidating } = useFetchAgentList();
  // Keep the label registry warm so the per-item "Labels" submenu opens populated.
  useFetchAgentLabels();
  // One "Agents" section in both modes. In a workspace it lists shared and
  // private rows together (private ones carry a lock icon).
  const { openConfigGroupModal } = useAgentModal();

  // One create menu in both modes. In a workspace each dialog (agent, group,
  // external agent) carries its own "Private / Workspace" field, defaulting to
  // private, so the menu no longer splits entries by visibility.
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();
  const addMenuItems = useMemo(() => createTopLevelMenuItems(), [createTopLevelMenuItems]);

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
          <AccordionTrigger style={sectionTriggerStyle}>
            <Flexbox horizontal align="center" gap={4}>
              <SectionTitle>{t('navPanel.agent')}</SectionTitle>
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
