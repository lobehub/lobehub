'use client';

import type {
  LocalAsrLanguage,
  LocalAsrPreferences,
  LocalAsrStatus,
  TranscriptionProvider,
} from '@lobechat/electron-client-ipc';
import { Alert, Flexbox, Segmented, Select, Text } from '@lobehub/ui';
import { Form, type FormGroupItem, useForm } from '@lobehub/ui/form';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import InstantSwitch from '@/components/InstantSwitch';
import { FORM_STYLE } from '@/const/layoutTokens';
import { electronLocalAsrService } from '@/services/electron/localAsr';
import { resolveTranscriptionProvider } from '@/services/transcriber';

const LANGUAGES: LocalAsrLanguage[] = ['zh', 'en', 'auto', 'ja', 'ko', 'yue'];

interface EngineSectionProps {
  onChange: (preferences: LocalAsrPreferences) => void;
  status: LocalAsrStatus;
}

const EngineSection = ({ status, onChange }: EngineSectionProps) => {
  const { t } = useTranslation('setting');
  const form = useForm();
  const { hardware, packs, preferences } = status;

  const asrReady = packs.find((pack) => pack.id === 'asr-sensevoice')?.status === 'ready';
  const diarizationReady = packs.find((pack) => pack.id === 'diarization')?.status === 'ready';
  const unsupported = hardware.tier === 'unsupported';
  const localDisabled = unsupported || !asrReady;
  const provider = resolveTranscriptionProvider(status);

  const update = async (patch: Partial<LocalAsrPreferences>) => {
    onChange(await electronLocalAsrService.setPreferences(patch));
  };

  let localHint: string | undefined;
  if (unsupported) localHint = t('localAsr.provider.localUnsupported');
  else if (!asrReady) localHint = t('localAsr.provider.localNeedsModel');

  const group: FormGroupItem = {
    children: [
      {
        children: (
          <Flexbox align={'flex-end'} gap={6}>
            <Segmented<TranscriptionProvider>
              value={provider}
              options={[
                { label: t('localAsr.provider.cloud'), value: 'cloud' },
                { disabled: localDisabled, label: t('localAsr.provider.local'), value: 'local' },
              ]}
              onChange={(provider) => update({ provider })}
            />
            {localHint && (
              <Text fontSize={12} type={'secondary'}>
                {localHint}
              </Text>
            )}
          </Flexbox>
        ),
        desc: t('localAsr.provider.desc'),
        label: t('localAsr.provider.title'),
        minWidth: undefined,
      },
      {
        children: (
          <Select
            style={{ minWidth: 160 }}
            value={preferences.language}
            options={LANGUAGES.map((language) => ({
              label: t(`localAsr.language.${language}`),
              value: language,
            }))}
            onChange={(language) => update({ language: language as LocalAsrLanguage })}
          />
        ),
        desc: t('localAsr.language.desc'),
        label: t('localAsr.language.title'),
        minWidth: undefined,
      },
      {
        children: (
          <InstantSwitch
            // InstantSwitch only seeds from `enabled` once; remount when the model becomes usable.
            disabled={!diarizationReady}
            enabled={preferences.diarization && diarizationReady}
            key={String(diarizationReady)}
            onChange={(diarization) => update({ diarization })}
          />
        ),
        desc: t('localAsr.diarization.desc'),
        label: t('localAsr.diarization.title'),
        minWidth: undefined,
      },
    ],
    desc: t('localAsr.desc'),
    title: t('localAsr.title'),
  };

  return (
    <Flexbox gap={12}>
      <Form
        collapsible={false}
        form={form}
        items={[group]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
      {provider === 'local' && (
        <Alert
          showIcon
          icon={ShieldCheck}
          title={t('localAsr.privacy')}
          type={'success'}
          variant={'filled'}
        />
      )}
    </Flexbox>
  );
};

export default EngineSection;
