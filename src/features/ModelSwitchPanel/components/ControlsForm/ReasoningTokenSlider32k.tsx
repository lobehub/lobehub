import { Flexbox, InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

const Kibi = 1024;
const MAX_VALUE = 32 * Kibi; // 32768

// Mark values mapped by equal-spaced indices
const MARK_TOKENS = [1, 2, 4, 8, 16, 32];

interface ReasoningTokenSlider32kProps {
  defaultValue?: number;
  onChange?: (value: number) => void;
  value?: number;
}

const ReasoningTokenSlider32k = memo<ReasoningTokenSlider32kProps>(
  ({ value, onChange, defaultValue }) => {
    const [token, setTokens] = useMergeState(0, {
      defaultValue,
      onChange,
      value,
    });

    // Convert token value to index
    const tokenToIndex = (t: number): number => {
      const k = t / Kibi;
      for (let i = 0; i < MARK_TOKENS.length - 1; i++) {
        if (k <= MARK_TOKENS[i]) return i;
      }
      return MARK_TOKENS.length - 1;
    };

    const [sliderIndex, setSliderIndex] = useMergeState(0, {
      defaultValue: typeof defaultValue === 'undefined' ? 0 : tokenToIndex(defaultValue),
      value: typeof value === 'undefined' ? 0 : tokenToIndex(value),
    });

    const marks = useMemo(() => {
      return MARK_TOKENS.reduce(
        (acc, token, index) => {
          acc[index] = `${token}k`;
          return acc;
        },
        {} as Record<number, string>,
      );
    }, []);

    const step = useMemo(() => {
      const current = token ?? 0;

      if (current <= Kibi) return 128;

      if (current < 8 * Kibi) return Kibi;

      return 4 * Kibi;
    }, [token]);

    return (
      <Flexbox horizontal align={'center'} gap={12} paddingInline={'4px 0'}>
        <Flexbox flex={1} style={{ minWidth: 200, maxWidth: 320 }}>
          <Slider
            marks={marks}
            max={MARK_TOKENS.length - 1}
            min={0}
            step={null}
            tooltip={{ open: false }}
            value={sliderIndex}
            onChange={(v) => {
              setSliderIndex(v);
              setTokens(MARK_TOKENS[v] * Kibi);
            }}
          />
        </Flexbox>
        <div>
          <InputNumber
            changeOnWheel
            max={MAX_VALUE}
            min={0}
            step={step}
            style={{ width: 80 }}
            value={token}
            onChange={(e) => {
              if (!e && e !== 0) return;
              const clampedValue = Math.min(Math.round(e as number), MAX_VALUE);
              setTokens(clampedValue);
              setSliderIndex(tokenToIndex(clampedValue));
            }}
          />
        </div>
      </Flexbox>
    );
  },
);

export default ReasoningTokenSlider32k;
