'use client';

import { AccordionItem, ContextMenuTrigger, Flexbox, Text } from '@lobehub/ui';
import React, { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';

import SkeletonList from '../../../../../../../features/NavPanel/components/SkeletonList';
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

  const { openConfigGroupModal } = useAgentModal();

  // Create menu items
  const { isLoading } = useCreateMenuItems();

  const handleOpenConfigGroupModal = useCallback(() => {
    openConfigGroupModal();
  }, [openConfigGroupModal]);

  const dropdownMenu = useAgentActionsDropdownMenu({
    openConfigGroupModal: handleOpenConfigGroupModal,
  });

  return (
    <AccordionItem
      action={<Actions dropdownMenu={dropdownMenu} isLoading={isLoading} />}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('navPanel.agent')}
          </Text>
          {isRevalidating && <NeuralNetworkLoading size={14} />}
        </Flexbox>
      }
    >
      <Suspense fallback={<SkeletonList rows={6} />}>
        <Flexbox gap={4} paddingBlock={1}>
          <List />
        </Flexbox>
      </Suspense>
    </AccordionItem>
  );
});

export default Agent;
