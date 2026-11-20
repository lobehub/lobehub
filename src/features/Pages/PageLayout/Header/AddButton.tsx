'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { pageActions } from '@/store/page';
import { useHeaderActionSize } from '@/styles/density';

const AddButton = memo(() => {
  const { t } = useTranslation('file');
  const headerActionSize = useHeaderActionSize(true);
  const { allowed: canCreate } = usePermission('create_content');

  const handleNewDocument = () => {
    if (!canCreate) return;

    const untitledTitle = t('pageList.untitled');
    pageActions.createNewPage(untitledTitle);
  };

  return (
    <ActionIcon
      disabled={!canCreate}
      icon={SquarePenIcon}
      size={headerActionSize}
      title={t('header.newPageButton')}
      onClick={handleNewDocument}
    />
  );
});

export default AddButton;
