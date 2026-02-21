import { Flexbox, InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import { useIsMobile } from '@/hooks/useIsMobile';

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
    value: value,
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

  const marks = useMemo(() => {
    return {
      [exponent(2)]: '0',
      [exponent(4)]: isMobile ? '4' : '4K', // 4 Kibi = 4096
      [exponent(8)]: isMobile ? '8' : '8K',
      [exponent(16)]: isMobile ? '16' : '16K',
      [exponent(32)]: isMobile ? '32' : '32K',
      [exponent(64)]: isMobile ? '64' : '64K',
      [exponent((128 / Kibi) * 1000)]: ' ', // hide tick mark
      [exponent((200 / Kibi) * 1000)]: isMobile ? '200' : '200k', // 200,000
      [exponent(Kibi)]: '1M',
      [exponent(2 * Kibi)]: '2M',
    };
  }, [isMobile]);

  return (
    <Flexbox horizontal align={'center'} gap={12}>
      <Flexbox flex={1}>
        <Slider
          marks={marks}
          max={exponent(2 * Kibi)}
          min={exponent(2)}
          step={null}
          value={powValue}
          tooltip={{
            formatter: (x) => {
              if (typeof x === 'undefined') return;
              if (x <= exponent(2)) return t('MaxTokenSlider.unlimited');

              const value = getRealValue(x);
              if (value < 125) return value.toFixed(0) + 'K';
              else if (value < Kibi) return ((value * Kibi) / 1000).toFixed(0) + 'k';
              return (value / Kibi).toFixed(0) + 'M';
            },
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
