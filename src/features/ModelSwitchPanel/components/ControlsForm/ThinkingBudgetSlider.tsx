import { Flexbox, InputNumber } from '@lobehub/ui';
import { Slider } from 'antd';
import { memo, useMemo } from 'react';
import useMergeState from 'use-merge-value';

// 定义特殊值映射
const SPECIAL_VALUES = {
  AUTO: -1,
  OFF: 0,
};

// 定义滑块位置到实际值的映射
const SLIDER_TO_VALUE_MAP = [
  SPECIAL_VALUES.AUTO, // 位置 0 -> -1 (Auto)
  SPECIAL_VALUES.OFF, // 位置 1 -> 0 (OFF)
  128, // 位置 2 -> 128
  512, // 位置 3 -> 512
  1024, // 位置 4 -> 1024
  2048, // 位置 5 -> 2048
  4096, // 位置 6 -> 4096
  8192, // 位置 7 -> 8192
  16_384, // 位置 8 -> 16384
  24_576, // 位置 9 -> 24576
  32_768, // 位置 10 -> 32768
];

// 从实际值获取滑块位置
const getSliderPosition = (value: number): number => {
  const exactIndex = SLIDER_TO_VALUE_MAP.indexOf(value);
  if (exactIndex !== -1) return exactIndex;

  if (value <= SPECIAL_VALUES.AUTO) return 0;
  if (value > SPECIAL_VALUES.OFF && value <= 128) return 2;

  let position = 0;

  for (const [index, mappedValue] of SLIDER_TO_VALUE_MAP.entries()) {
    if (mappedValue <= value) {
      position = index;
      continue;
    }

    break;
  }

  return position;
};

// 从滑块位置获取实际值（修复：0 不再被当作 falsy）
const getValueFromPosition = (position: number): number => {
  const v = SLIDER_TO_VALUE_MAP[position];
  return v === undefined ? SPECIAL_VALUES.AUTO : v;
};

const getStepForValue = (value: number): number => {
  if (value < 0) return 1;
  if (value <= 1024) return 128;
  if (value < 8192) return 1024;
  return 2048;
};

interface ThinkingBudgetSliderProps {
  defaultValue?: number;
  onChange?: (value: number) => void;
  value?: number;
}

const ThinkingBudgetSlider = memo<ThinkingBudgetSliderProps>(
  ({ value, onChange, defaultValue }) => {
    // 首先确定初始的 budget 值
    const initialBudget = value ?? defaultValue ?? SPECIAL_VALUES.AUTO;

    const [budget, setBudget] = useMergeState(initialBudget, {
      defaultValue,
      onChange,
      value,
    });

    const sliderPosition = getSliderPosition(budget);

    const updateWithSliderPosition = (position: number) => {
      const newValue = getValueFromPosition(position);
      setBudget(newValue);
    };

    const updateWithRealValue = (value: number) => {
      setBudget(value);
    };

    const inputStep = useMemo(() => getStepForValue(budget), [budget]);

    const marks = useMemo(() => {
      return {
        0: 'Auto',
        1: 'OFF',
        2: '128',
        3: '512',
        4: '1K',
        5: '2K',
        6: '4K',
        7: '8K',
        8: '16K',
        9: '24K',
        10: '32K',
      };
    }, []);

    return (
      <Flexbox horizontal align={'center'} gap={12} paddingInline={'4px 0'}>
        <Flexbox flex={1}>
          <Slider
            marks={marks}
            max={10}
            min={0}
            step={null}
            tooltip={{ open: false }}
            value={sliderPosition}
            onChange={updateWithSliderPosition}
          />
        </Flexbox>
        <div>
          <InputNumber
            changeOnWheel
            max={32_768}
            min={-1}
            step={inputStep}
            style={{ width: 80 }}
            value={budget}
            formatter={(value, _info) => {
              if (value === SPECIAL_VALUES.AUTO) return 'Auto';
              if (value === SPECIAL_VALUES.OFF) return 'OFF';
              return `${value}`;
            }}
            parser={(value) => {
              if (typeof value === 'string') {
                if (value.toLowerCase() === 'auto') return SPECIAL_VALUES.AUTO;
                if (value.toLowerCase() === 'off') return SPECIAL_VALUES.OFF;
                return parseInt(value.replaceAll(/[^\d-]/g, ''), 10) || 0;
              }
              if (typeof value === 'number') {
                return value;
              }
              return SPECIAL_VALUES.AUTO;
            }}
            onChange={(e) => {
              if (e === null || e === undefined) return;
              updateWithRealValue(e as number);
            }}
          />
        </div>
      </Flexbox>
    );
  },
);

export default ThinkingBudgetSlider;
