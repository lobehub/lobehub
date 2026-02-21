'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { useImageStore } from '@/store/image/store';

import CfgSliderInput from './components/CfgSliderInput';
import DimensionControlGroup from './components/DimensionControlGroup';
import ImageNum from './components/ImageNum';
import ImageUrl from './components/ImageUrl';
import ImageUrlsUpload from './components/ImageUrlsUpload';
import ModelSelect from './components/ModelSelect';
import QualitySelect from './components/QualitySelect';
import ResolutionSelect from './components/ResolutionSelect';
import SeedNumberInput from './components/SeedNumberInput';
import SizeSelect from './components/SizeSelect';
import StepsSliderInput from './components/StepsSliderInput';
import ImageConfigSkeleton from './ImageConfigSkeleton';

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

const isSupportedParamSelector = imageGenerationConfigSelectors.isSupportedParam;

const ConfigPanel = memo(() => {
  const { t } = useTranslation('image');

  // Initialize image configuration
  useFetchAiImageConfig();

  // All hooks must be called before any early returns
  const isInit = useImageStore((s) => s.isInit);
  const isSupportImageUrl = useImageStore(isSupportedParamSelector('imageUrl'));
  const isSupportSize = useImageStore(isSupportedParamSelector('size'));
  const isSupportQuality = useImageStore(isSupportedParamSelector('quality'));
  const isSupportResolution = useImageStore(isSupportedParamSelector('resolution'));
  const isSupportSeed = useImageStore(isSupportedParamSelector('seed'));
  const isSupportSteps = useImageStore(isSupportedParamSelector('steps'));
  const isSupportCfg = useImageStore(isSupportedParamSelector('cfg'));
  const isSupportImageUrls = useImageStore(isSupportedParamSelector('imageUrls'));

  const { showDimensionControl } = useDimensionControl();

  // Show loading state if not initialized
  if (!isInit) {
    return <ImageConfigSkeleton />;
  }

  return (
    <Flexbox gap={16} padding={10}>
      <ConfigItemLayout>
        <ModelSelect />
      </ConfigItemLayout>

      {isSupportImageUrl && (
        <ConfigItemLayout label={t('config.imageUrl.label')}>
          <ImageUrl />
        </ConfigItemLayout>
      )}

      {isSupportImageUrls && (
        <ConfigItemLayout label={t('config.imageUrls.label')}>
          <ImageUrlsUpload />
        </ConfigItemLayout>
      )}

      {isSupportSize && (
        <ConfigItemLayout label={t('config.size.label')}>
          <SizeSelect />
        </ConfigItemLayout>
      )}

      {isSupportQuality && (
        <ConfigItemLayout label={t('config.quality.label')}>
          <QualitySelect />
        </ConfigItemLayout>
      )}

      {isSupportResolution && (
        <ConfigItemLayout label={t('config.resolution.label')}>
          <ResolutionSelect />
        </ConfigItemLayout>
      )}

      {showDimensionControl && <DimensionControlGroup />}

      {isSupportSteps && (
        <ConfigItemLayout label={t('config.steps.label')}>
          <StepsSliderInput />
        </ConfigItemLayout>
      )}

      {isSupportCfg && (
        <ConfigItemLayout label={t('config.cfg.label')}>
          <CfgSliderInput />
        </ConfigItemLayout>
      )}

      {isSupportSeed && (
        <ConfigItemLayout label={t('config.seed.label')}>
          <SeedNumberInput />
        </ConfigItemLayout>
      )}

      <ConfigItemLayout label={t('config.imageNum.label')}>
        <ImageNum />
      </ConfigItemLayout>
    </Flexbox>
  );
});

export default ConfigPanel;
