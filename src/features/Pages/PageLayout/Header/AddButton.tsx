'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { usePageStore } from '@/store/page';

const AddButton = memo(() => {
  const { t } = useTranslation('file');
  const { allowed: canCreate } = usePermission('create_content');

  const createNewPage = usePageStore((s) => s.createNewPage);

  const handleNewDocument = () => {
    if (!canCreate) return;

    const untitledTitle = t('pageList.untitled');
    createNewPage(untitledTitle);
  };

  return (
    <ActionIcon
      disabled={!canCreate}
      icon={SquarePenIcon}
      title={t('header.newPageButton')}
      size={{
        blockSize: 32,
        size: 18,
      }}
      onClick={handleNewDocument}
    />
  );
});

export default AddButton;
