'use client';

import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import { ManageMemoryButton } from './features/ManageMemoryButton';
import Memory from './features/Memory';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && (
        <SettingHeader extra={<ManageMemoryButton />} title={t('tab.memory')} />
      )}
      <Memory />
    </>
  );
};

export default Page;
