'use client';

import {
  Button,
  Flexbox,
  InputNumber,
  Segmented,
  SliderWithInput,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { Switch } from 'antd';
import { Dices } from 'lucide-react';
import { MAX_VIDEO_SEED } from 'model-bank';
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AspectRatioSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/AspectRatioSelect';
import { useFetchAiVideoConfig } from '@/hooks/useFetchAiVideoConfig';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { useVideoStore } from '@/store/video/store';
import { generateUniqueSeeds } from '@/utils/number';

import FrameUpload from './components/FrameUpload';
import ModelSelect from './components/ModelSelect';
import VideoConfigSkeleton from './VideoConfigSkeleton';

interface ConfigItemLayoutProps {
  children: ReactNode;
  label?: string;
}

const ConfigItemLayout = memo<ConfigItemLayoutProps>(({ label, children }) => {
  return (
    <Flexbox gap={8}>
      {label && <Text weight={500}>{label}</Text>}
      {children}
    </Flexbox>
  );
});

const isSupportedParamSelector = videoGenerationConfigSelectors.isSupportedParam;

const AspectRatioItem = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('aspectRatio');

  const options = useMemo(() => (enumValues ?? []).map((v) => ({ value: v })), [enumValues]);

  return <AspectRatioSelect options={options} value={value} onChange={(v) => setValue(v as any)} />;
});

const ResolutionItem = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('resolution');

  const options = useMemo(() => {
    if (!enumValues || enumValues.length === 0) return [];
    return enumValues.map((v) => ({ label: v, value: v }));
  }, [enumValues]);

  if (options.length === 0) return null;

  return (
    <Segmented
      block
      options={options}
      style={{ width: '100%' }}
      value={value}
      variant="filled"
      onChange={(v) => setValue(String(v) as any)}
    />
  );
});

const DurationItem = memo(() => {
  const { value, setValue, min, max, step } = useVideoGenerationConfigParam('duration');

  return (
    <SliderWithInput
      max={max}
      min={min}
      step={step ?? 1}
      value={value ?? min}
      onChange={(v) => setValue(v as any)}
    />
  );
});

const SeedItem = memo(() => {
  const { t } = useTranslation('video');
  const { value, setValue } = useVideoGenerationConfigParam('seed');

  const handleRandomize = useCallback(() => {
    setValue(generateUniqueSeeds(1)[0] as any);
  }, [setValue]);

  return (
    <Flexbox horizontal gap={4}>
      <InputNumber
        max={MAX_VIDEO_SEED}
        min={0}
        placeholder={t('config.seed.random')}
        step={1}
        style={{ width: '100%' }}
        value={value}
        onChange={(v) => setValue(v as any)}
      />
      <Tooltip title={t('config.seed.random')}>
        <Button
          icon={Dices}
          style={{ flex: 'none', width: 48 }}
          variant={'outlined'}
          onClick={handleRandomize}
        />
      </Tooltip>
    </Flexbox>
  );
});

interface SwitchItemProps {
  label: string;
  paramName: 'cameraFixed' | 'generateAudio';
}

const SwitchItem = memo<SwitchItemProps>(({ label, paramName }) => {
  const { value, setValue } = useVideoGenerationConfigParam(paramName);

  return (
    <Flexbox horizontal align="center" justify="space-between" padding={'0 2px'}>
      <Text weight={500}>{label}</Text>
      <Switch checked={!!value} onChange={(checked) => setValue(checked as any)} />
    </Flexbox>
  );
});

const ConfigPanel = memo(() => {
  const { t } = useTranslation('video');

  // Initialize video configuration
  useFetchAiVideoConfig();

  const isInit = useVideoStore((s) => s.isInit);
  const isSupportImageUrl = useVideoStore(isSupportedParamSelector('imageUrl'));
  const isSupportEndImageUrl = useVideoStore(isSupportedParamSelector('endImageUrl'));
  const isSupportAspectRatio = useVideoStore(isSupportedParamSelector('aspectRatio'));
  const isSupportResolution = useVideoStore(isSupportedParamSelector('resolution'));
  const isSupportDuration = useVideoStore(isSupportedParamSelector('duration'));
  const isSupportSeed = useVideoStore(isSupportedParamSelector('seed'));
  const isSupportGenerateAudio = useVideoStore(isSupportedParamSelector('generateAudio'));
  const isSupportCameraFixed = useVideoStore(isSupportedParamSelector('cameraFixed'));

  // Show loading state if not initialized
  if (!isInit) {
    return <VideoConfigSkeleton />;
  }

  const imageUrlLabel = isSupportEndImageUrl
    ? t('config.imageUrl.label')
    : t('config.referenceImage.label');

  return (
    <Flexbox gap={16} padding={10}>
      <ConfigItemLayout>
        <ModelSelect />
      </ConfigItemLayout>

      {isSupportImageUrl && (
        <ConfigItemLayout label={imageUrlLabel}>
          <FrameUpload paramName="imageUrl" />
        </ConfigItemLayout>
      )}

      {isSupportEndImageUrl && (
        <ConfigItemLayout label={t('config.endImageUrl.label')}>
          <FrameUpload paramName="endImageUrl" />
        </ConfigItemLayout>
      )}

      {isSupportAspectRatio && (
        <ConfigItemLayout label={t('config.aspectRatio.label')}>
          <AspectRatioItem />
        </ConfigItemLayout>
      )}

      {isSupportResolution && (
        <ConfigItemLayout label={t('config.resolution.label')}>
          <ResolutionItem />
        </ConfigItemLayout>
      )}

      {isSupportDuration && (
        <ConfigItemLayout label={t('config.duration.label')}>
          <DurationItem />
        </ConfigItemLayout>
      )}

      {isSupportSeed && (
        <ConfigItemLayout label={t('config.seed.label')}>
          <SeedItem />
        </ConfigItemLayout>
      )}

      {isSupportGenerateAudio && (
        <SwitchItem label={t('config.generateAudio.label')} paramName="generateAudio" />
      )}
      {isSupportCameraFixed && (
        <SwitchItem label={t('config.cameraFixed.label')} paramName="cameraFixed" />
      )}
    </Flexbox>
  );
});

export default ConfigPanel;
