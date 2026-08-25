import { Flexbox, InputNumber } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import { useIsMobile } from '@/hooks/useIsMobile';

import DiscreteSlider from './DiscreteSlider';

const Kibi = 1024;

const exponent = (num: number) => Math.log2(num);
const getRealValue = (num: number) => Math.round(Math.pow(2, num));
const powerKibi = (num: number) => Math.round(Math.pow(2, num) * Kibi);

interface MaxTokenSliderProps {
  defaultValue?: number;
  onChange?: (value: number) => void;
  value?: number;
}

const MaxTokenSlider = memo<MaxTokenSliderProps>(({ value, onChange, defaultValue }) => {
  const { t } = useTranslation('components');

  const [token, setTokens] = useMergeState(0, {
    defaultValue,
    onChange,
    value,
  });

  const [powValue, setPowValue] = useMergeState(0, {
    defaultValue: exponent(typeof defaultValue === 'undefined' ? 0 : defaultValue / 1024),
    value: exponent(typeof value === 'undefined' ? 0 : value / Kibi),
  });

  const updateWithPowValue = (value: number) => {
    setPowValue(value);

    setTokens(getRealValue(value) <= 2 ? 0 : powerKibi(value));
  };

  const updateWithRealValue = (value: number) => {
    setTokens(Math.round(value));

    setPowValue(exponent(value / Kibi));
  };

  const isMobile = useIsMobile();

  const options = useMemo(
    () => [
      { label: '0', value: exponent(2) },
      { label: isMobile ? '4' : '4K', value: exponent(4) }, // 4 Kibi = 4096
      { label: isMobile ? '8' : '8K', value: exponent(8) },
      { label: isMobile ? '16' : '16K', value: exponent(16) },
      { label: isMobile ? '32' : '32K', value: exponent(32) },
      { label: isMobile ? '64' : '64K', value: exponent(64) },
      { ariaLabel: '128k', label: ' ', value: exponent((128 / Kibi) * 1000) }, // hide tick label
      { label: isMobile ? '200' : '200k', value: exponent((200 / Kibi) * 1000) },
      { label: '1M', value: exponent(Kibi) },
      { label: '2M', value: exponent(2 * Kibi) },
    ],
    [isMobile],
  );

  return (
    <Flexbox horizontal align={'center'} gap={12}>
      <Flexbox flex={1}>
        <DiscreteSlider
          options={options}
          value={powValue}
          formatTooltip={(sliderValue) => {
            if (sliderValue <= exponent(2)) return t('MaxTokenSlider.unlimited');

            const realValue = getRealValue(sliderValue);
            if (realValue < 125) return realValue.toFixed(0) + 'K';
            if (realValue < Kibi) return ((realValue * Kibi) / 1000).toFixed(0) + 'k';
            return (realValue / Kibi).toFixed(0) + 'M';
          }}
          onChange={updateWithPowValue}
        />
      </Flexbox>
      <div>
        <InputNumber
          changeOnWheel
          min={0}
          step={4 * Kibi}
          value={token}
          onChange={(e) => {
            if (!e && e !== 0) return;
            updateWithRealValue(e as number);
          }}
        />
      </div>
    </Flexbox>
  );
});
export default MaxTokenSlider;
