'use client';

import { Text } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useFetchAiImageConfig } from '@/hooks/useFetchAiImageConfig';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { useImageStore } from '@/store/image/store';

import CfgSliderInput from './components/CfgSliderInput';
import DimensionControlGroup from './components/DimensionControlGroup';
import ImageConfigSkeleton from './components/ImageConfigSkeleton';
import ImageNum from './components/ImageNum';
import ImageUrl from './components/ImageUrl';
import ImageUrlsUpload from './components/ImageUrlsUpload';
import ModelSelect from './components/ModelSelect';
import QualitySelect from './components/QualitySelect';
import ResolutionSelect from './components/ResolutionSelect';
import SearchSwitch from './components/SearchSwitch';
import SeedNumberInput from './components/SeedNumberInput';
import SizeSelect from './components/SizeSelect';
import StepsSliderInput from './components/StepsSliderInput';

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
  const theme = useTheme();

  // Initialize image configuration
  useFetchAiImageConfig();

  // All hooks must be called before any early returns
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isScrollable, setIsScrollable] = useState(false);

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

  // Check if content exceeds container height and needs scrolling
  const checkScrollable = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const hasScrollbar = container.scrollHeight > container.clientHeight;
      setIsScrollable(hasScrollbar);
    }
  }, []);

  // Re-check when content changes
  useEffect(() => {
    checkScrollable();
  }, [
    checkScrollable,
    isSupportImageUrl,
    isSupportSize,
    isSupportQuality,
    isSupportResolution,
    isSupportSeed,
    isSupportSteps,
    isSupportCfg,
    isSupportImageUrls,
    showDimensionControl,
  ]);

  // Setup observers for container changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Initial check
    checkScrollable();

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(checkScrollable);
    resizeObserver.observe(container);

    // Use MutationObserver for content changes
    const mutationObserver = new MutationObserver(checkScrollable);
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [checkScrollable]);

  // Memoize sticky styles to prevent unnecessary re-renders
  const stickyStyles = useMemo(
    () => ({
      bottom: 0,
      position: 'sticky' as const,
      zIndex: 1,
      ...(isScrollable && {
        backgroundColor: theme.colorBgContainer,
        borderTop: `1px solid ${theme.colorBorder}`,
        // Use negative margin to extend background to container edges
        marginLeft: -12,
        marginRight: -12,
        marginTop: 20,
        // Add back internal padding
        paddingLeft: 12,
        paddingRight: 12,
      }),
    }),
    [isScrollable, theme.colorBgContainer, theme.colorBorder],
  );

  // Show loading state if not initialized
  if (!isInit) {
    return <ImageConfigSkeleton />;
  }

  return (
    <Flexbox
      gap={32}
      padding="12px 12px 0 12px"
      ref={scrollContainerRef}
      style={{ height: '100%', overflow: 'auto' }}
    >
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

      <SearchSwitch />

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

      <Flexbox padding="12px 0" style={stickyStyles}>
        <ConfigItemLayout label={t('config.imageNum.label')}>
          <ImageNum />
        </ConfigItemLayout>
      </Flexbox>
    </Flexbox>
  );
});

export default ConfigPanel;
