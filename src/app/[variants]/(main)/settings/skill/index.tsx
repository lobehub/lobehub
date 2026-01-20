'use client';

import { Button, Icon } from '@lobehub/ui';
import { Store } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import SkillStore from '@/features/SkillStore';

import SkillList from './features/SkillList';

const Page = () => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingHeader
        extra={
          <Button icon={<Icon icon={Store} />} onClick={() => setOpen(true)}>
            {t('skillStore.button')}
          </Button>
        }
        title={t('tab.skill')}
      />
      <SkillList />
      <SkillStore open={open} setOpen={setOpen} />
    </>
  );
};

Page.displayName = 'SkillsSetting';

export default Page;
