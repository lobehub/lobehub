'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SettingHeader from '@/features/Settings/features/SettingHeader';

import EngineSection from './features/EngineSection';
import HardwareSection from './features/HardwareSection';
import ModelSection from './features/ModelSection';
import TestSection from './features/TestSection';
import { useLocalAsrStatus } from './features/useLocalAsrStatus';

/** Desktop only: choose cloud or on-device meeting transcription and manage local models. */
const Page = () => {
  const { t } = useTranslation('setting');
  const { data, error, isValidating, mutate } = useLocalAsrStatus();

  let content;
  if (data) {
    content = (
      <>
        <EngineSection
          status={data}
          onChange={(preferences) => mutate({ ...data, preferences }, { revalidate: false })}
        />
        <HardwareSection hardware={data.hardware} />
        <ModelSection modelDir={data.modelDir} packs={data.packs} onSettled={() => mutate()} />
        <TestSection status={data} />
      </>
    );
  } else if (error) {
    content = (
      <AsyncError
        error={error}
        retrying={isValidating}
        variant={'block'}
        onRetry={() => mutate()}
      />
    );
  } else {
    content = <Skeleton.Text rows={8} />;
  }

  return (
    <>
      <SettingHeader title={t('tab.transcription')} />
      <Flexbox gap={16} style={{ maxWidth: 1024, width: '100%' }}>
        {content}
      </Flexbox>
    </>
  );
};

export default Page;
