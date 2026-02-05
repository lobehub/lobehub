'use client';

import { AccordionItem, ContextMenuTrigger, Text } from '@lobehub/ui';
import React, { memo,Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';

import Actions from './Actions';
import List from './List';
import { useProjectActionsDropdownMenu } from './useDropdownMenu';

interface ProjectProps {
  itemKey: string;
}

const Project = memo<ProjectProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const dropdownMenu = useProjectActionsDropdownMenu();
  return (
    <AccordionItem
      action={<Actions />}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      headerWrapper={(header) => (
        <ContextMenuTrigger items={dropdownMenu}>{header}</ContextMenuTrigger>
      )}
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {t('navPanel.library')}
        </Text>
      }
    >
      <Suspense fallback={<SkeletonList />}>
        <List />
      </Suspense>
    </AccordionItem>
  );
});

export default Project;
