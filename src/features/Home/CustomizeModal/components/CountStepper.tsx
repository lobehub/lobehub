'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface CountStepperProps {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}

const styles = stylex.create({ value: { width: '20px', textAlign: 'center' } });

const CountStepper = memo<CountStepperProps>(({ disabled, label, value, min, max, onChange }) => {
  const { t } = useTranslation('home');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <ActionIcon
        aria-label={t('dashboard.customize.decrease', { label })}
        disabled={disabled || value <= min}
        icon={MinusIcon}
        size={'small'}
        onClick={() => onChange(value - 1)}
      />
      <Text
        aria-label={label}
        aria-live={'polite'}
        className={stylex.props(styles.value).className}
        type={disabled ? 'secondary' : undefined}
        weight={500}
      >
        {value}
      </Text>
      <ActionIcon
        aria-label={t('dashboard.customize.increase', { label })}
        disabled={disabled || value >= max}
        icon={PlusIcon}
        size={'small'}
        onClick={() => onChange(value + 1)}
      />
    </Flexbox>
  );
});

export default CountStepper;
