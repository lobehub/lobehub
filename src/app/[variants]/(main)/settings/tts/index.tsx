import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';

import OpenAI from './features/OpenAI';
import STT from './features/STT';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.tts')} />
      <STT />
      <OpenAI />
    </>
  );
};

Page.displayName = 'TtsSetting';

export default Page;
