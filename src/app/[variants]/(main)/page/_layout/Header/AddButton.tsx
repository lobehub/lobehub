'use client';

import { ActionIcon } from '@lobehub/ui';
import { SquarePenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageStore } from '@/store/page';

const AddButton = memo(() => {
  const { t } = useTranslation('file');

  const createNewPage = usePageStore((s) => s.createNewPage);

  const handleNewDocument = () => {
    const untitledTitle = t('pageList.untitled');
    createNewPage(untitledTitle);
  };

  return (
    <ActionIcon
      icon={SquarePenIcon}
      onClick={handleNewDocument}
      size={{
        blockSize: 32,
        size: 18,
      }}
      title={t('header.newPageButton')}
    />
  );
});

export default AddButton;
