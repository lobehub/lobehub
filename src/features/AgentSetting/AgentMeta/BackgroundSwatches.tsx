import { type ColorSwatchesProps } from '@lobehub/ui';
import { ColorSwatches, primaryColors } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_BACKGROUND_COLOR } from '@/const/meta';

interface BackgroundSwatchesProps extends Omit<ColorSwatchesProps, 'colors'> {
  onValuesChange?: ColorSwatchesProps['onChange'];
}

const BackgroundSwatches = memo<BackgroundSwatchesProps>(
  ({ defaultValue = DEFAULT_BACKGROUND_COLOR, value, onChange, onValuesChange, ...rest }) => {
    const { t } = useTranslation('color');

    const colors = useMemo(
      () => [
        {
          color: 'rgba(0, 0, 0, 0)',
          title: t('default'),
        },
        {
          color: primaryColors.red,
          title: t('red'),
        },
        {
          color: primaryColors.orange,
          title: t('orange'),
        },
        {
          color: primaryColors.gold,
          title: t('gold'),
        },
        {
          color: primaryColors.yellow,
          title: t('yellow'),
        },
        {
          color: primaryColors.lime,
          title: t('lime'),
        },
        {
          color: primaryColors.green,
          title: t('green'),
        },
        {
          color: primaryColors.cyan,
          title: t('cyan'),
        },
        {
          color: primaryColors.blue,
          title: t('blue'),
        },
        {
          color: primaryColors.geekblue,
          title: t('geekblue'),
        },
        {
          color: primaryColors.purple,
          title: t('purple'),
        },
        {
          color: primaryColors.magenta,
          title: t('magenta'),
        },
        {
          color: primaryColors.volcano,
          title: t('volcano'),
        },
      ],
      [t],
    );

    return (
      <ColorSwatches
        enableColorPicker
        colors={colors}
        defaultValue={defaultValue}
        value={value}
        onChange={(v) => {
          onChange?.(v);
          onValuesChange?.(v);
        }}
        {...rest}
      />
    );
  },
);

export default BackgroundSwatches;
