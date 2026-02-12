'use client';

import { ActionIcon, Flexbox, SliderWithInput } from '@lobehub/ui';
import { LockIcon, UnlockIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';

import AspectRatioSelect from './AspectRatioSelect';

const styles = {
  aspectRatioSelect: {
    width: '100%',
  },
  label: {
    fontWeight: 500,
  },
} as const;

const DimensionControlGroup = memo(() => {
  const { t } = useTranslation('image');
  const {
    isLocked,
    toggleLock,
    width,
    height,
    aspectRatio,
    setWidth,
    setHeight,
    setAspectRatio,
    widthSchema,
    heightSchema,
    options,
  } = useDimensionControl();

  // 构建宽高比选择器的选项
  const aspectRatioOptions = useMemo(
    () =>
      options.map((ratio) => ({
        label: ratio,
        value: ratio,
      })),
    [options],
  );

  const lockButtonTitle = isLocked ? t('config.aspectRatio.unlock') : t('config.aspectRatio.lock');

  const lockIcon = isLocked ? LockIcon : UnlockIcon;

  return (
    <Flexbox gap={16}>
      {/* 宽高比选择器 */}
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" distribution="space-between">
          <span style={styles.label}>{t('config.aspectRatio.label')}</span>
          <ActionIcon
            aria-label={lockButtonTitle}
            icon={lockIcon}
            size="small"
            title={lockButtonTitle}
            onClick={toggleLock}
          />
        </Flexbox>
        <AspectRatioSelect
          options={aspectRatioOptions}
          style={styles.aspectRatioSelect}
          value={aspectRatio}
          onChange={setAspectRatio}
        />
      </Flexbox>

      {/* 宽度滑块 */}
      {widthSchema && (
        <Flexbox gap={8}>
          <span style={styles.label}>{t('config.width.label')}</span>
          <SliderWithInput
            max={widthSchema.max}
            min={widthSchema.min}
            value={width ?? widthSchema.min}
            onChange={setWidth}
          />
        </Flexbox>
      )}

      {/* 高度滑块 */}
      {heightSchema && (
        <Flexbox gap={8}>
          <span style={styles.label}>{t('config.height.label')}</span>
          <SliderWithInput
            max={heightSchema.max}
            min={heightSchema.min}
            value={height ?? heightSchema.min}
            onChange={setHeight}
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

DimensionControlGroup.displayName = 'DimensionControlGroup';

export default DimensionControlGroup;
