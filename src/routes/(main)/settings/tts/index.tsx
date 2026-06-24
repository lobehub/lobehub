import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import OpenAI from './features/OpenAI';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.tts')} />
      <OpenAI />
    </>
  );
};

export default Page;
