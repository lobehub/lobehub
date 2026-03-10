'use client';

import { ActionIcon } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CreateNewProvider from '../features/CreateNewProvider';

const AddNewProvider = () => {
  const { t } = useTranslation('modelProvider');
  const [open, setOpen] = useState(false);

  return (
    <>
      <ActionIcon
        icon={PlusIcon}
        size={'small'}
        title={t('menu.addCustomProvider')}
        onClick={() => setOpen(true)}
      />
      <CreateNewProvider open={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default AddNewProvider;
