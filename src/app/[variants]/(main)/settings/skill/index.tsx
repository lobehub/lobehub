'use client';

import { Button, Icon } from '@lobehub/ui';
import { Store } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { createSkillStoreModal } from '@/features/SkillStore';

import SkillList from './features/SkillList';

const Page = () => {
  const { t } = useTranslation('setting');

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  return (
    <>
      <SettingHeader
        title={t('tab.skill')}
        extra={
          <Button icon={<Icon icon={Store} />} size="large" onClick={handleOpenStore}>
            {t('skillStore.button')}
          </Button>
        }
      />
      <SkillList />
    </>
  );
};

Page.displayName = 'SkillsSetting';

export default Page;
