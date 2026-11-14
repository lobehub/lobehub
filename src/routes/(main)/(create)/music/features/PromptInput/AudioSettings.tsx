'use client';

import { Flexbox, InputNumber, Select, Text } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMusicStore } from '@/store/music';
import { musicGenerationConfigSelectors } from '@/store/music/selectors';
import { useMusicGenerationConfigParam } from '@/store/music/slices/generationConfig/hooks';

const isSupported = musicGenerationConfigSelectors.isSupportedParam;

const DurationItem = memo(() => {
  const { t } = useTranslation('music');
  const { value, setValue, schema } = useMusicGenerationConfigParam('duration');

  return (
    <InputNumber
      aria-label={t('config.duration.label')}
      max={schema?.max}
      min={schema?.min}
      placeholder={t('config.duration.auto')}
      step={schema?.step ?? 1}
      style={{ width: '100%' }}
      suffix={'s'}
      value={value ?? null}
      onChange={(next) => setValue(typeof next === 'number' ? next : null)}
    />
  );
});

DurationItem.displayName = 'MusicDurationItem';

const formatHz = (value: number) => `${(value / 1000).toLocaleString()} kHz`;
const formatBps = (value: number) => `${Math.round(value / 1000)} kbps`;

const EnumItem = memo<{ format?: (v: number) => string; paramName: 'bitrate' | 'sampleRate' }>(
  ({ paramName, format }) => {
    const { value, setValue, schema } = useMusicGenerationConfigParam(paramName);
    const options = useMemo(
      () => (schema?.enum ?? []).map((v) => ({ label: format ? format(v) : String(v), value: v })),
      [format, schema?.enum],
    );

    return (
      <Select
        options={options}
        style={{ width: '100%' }}
        value={value}
        onChange={(next) => setValue(next as number)}
      />
    );
  },
);

EnumItem.displayName = 'MusicEnumItem';

const FormatItem = memo(() => {
  const { value, setValue, schema } = useMusicGenerationConfigParam('format');
  const options = useMemo(
    () => (schema?.enum ?? []).map((v) => ({ label: v.toUpperCase(), value: v })),
    [schema?.enum],
  );

  return (
    <Select
      options={options}
      style={{ width: '100%' }}
      value={value}
      onChange={(next) => setValue(next as typeof value)}
    />
  );
});

FormatItem.displayName = 'MusicFormatItem';

export const useHasAudioSettings = () => {
  const supportsDuration = useMusicStore(isSupported('duration'));
  const supportsFormat = useMusicStore(isSupported('format'));
  const supportsSampleRate = useMusicStore(isSupported('sampleRate'));
  const supportsBitrate = useMusicStore(isSupported('bitrate'));

  return supportsDuration || supportsFormat || supportsSampleRate || supportsBitrate;
};

/** Length and output settings, shown in the config popover only for params the model declares */
const AudioSettings = memo(() => {
  const { t } = useTranslation('music');
  const supportsDuration = useMusicStore(isSupported('duration'));
  const supportsFormat = useMusicStore(isSupported('format'));
  const supportsSampleRate = useMusicStore(isSupported('sampleRate'));
  const supportsBitrate = useMusicStore(isSupported('bitrate'));

  return (
    <Flexbox gap={12} style={{ minWidth: 220 }}>
      {supportsDuration && (
        <Flexbox gap={6}>
          <Text fontSize={12}>{t('config.duration.label')}</Text>
          <DurationItem />
        </Flexbox>
      )}
      {supportsFormat && (
        <Flexbox gap={6}>
          <Text fontSize={12}>{t('config.format.label')}</Text>
          <FormatItem />
        </Flexbox>
      )}
      {supportsSampleRate && (
        <Flexbox gap={6}>
          <Text fontSize={12}>{t('config.sampleRate.label')}</Text>
          <EnumItem format={formatHz} paramName={'sampleRate'} />
        </Flexbox>
      )}
      {supportsBitrate && (
        <Flexbox gap={6}>
          <Text fontSize={12}>{t('config.bitrate.label')}</Text>
          <EnumItem format={formatBps} paramName={'bitrate'} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

AudioSettings.displayName = 'MusicAudioSettings';

export default AudioSettings;
