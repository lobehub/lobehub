'use client';

import { Flexbox } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/features/Settings/features/SettingHeader';
import { isMobileSurface } from '@/utils/mobileSurface';

import { ManageMemoryButton } from './features/ManageMemoryButton';
import Memory from './features/Memory';

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t } = useTranslation('setting');
  return (
    <>
      {showSettingHeader && <SettingHeader title={t('tab.memory')} />}
      {isMobileSurface() && (
        <Flexbox horizontal justify={'flex-end'} paddingBlock={8} paddingInline={16}>
          <ManageMemoryButton />
        </Flexbox>
      )}
      <Memory />
    </>
  );
};

export default Page;
