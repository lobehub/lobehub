'use client';

import { AccordionItem, ActionIcon, Dropdown, Flexbox, Text } from '@lobehub/ui';
import { Loader2Icon } from 'lucide-react';
import React, { Suspense, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
      headerWrapper={(header) => (
        <Dropdown
          menu={{
            items: dropdownMenu,
          }}
          trigger={['contextMenu']}
        >
          {header}
        </Dropdown>
      )}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Flexbox align="center" gap={4} horizontal>
          <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
            {t('navPanel.agent')}
          </Text>
          {isRevalidating && <ActionIcon icon={Loader2Icon} loading size={'small'} />}
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
