'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface CountStepperProps {
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}

const styles = createStaticStyles(({ css }) => ({
  value: css`
    width: 20px;
    text-align: center;
  `,
}));

const CountStepper = memo<CountStepperProps>(({ value, min, max, onChange }) => {
  const { t } = useTranslation('home');

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <ActionIcon
        aria-label={t('dashboard.customize.decrease')}
        disabled={value <= min}
        icon={MinusIcon}
        size={'small'}
        onClick={() => onChange(value - 1)}
      />
      <Text aria-live={'polite'} className={styles.value} weight={500}>
        {value}
      </Text>
      <ActionIcon
        aria-label={t('dashboard.customize.increase')}
        disabled={value >= max}
        icon={PlusIcon}
        size={'small'}
        onClick={() => onChange(value + 1)}
      />
    </Flexbox>
  );
});

export default CountStepper;
