'use client';

import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import SkillList from './features/SkillList';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.skills')} />
      <SkillList />
    </>
  );
};

Page.displayName = 'SkillsSetting';

export default Page;
