'use client';

import { Button, Flexbox, InputNumber, Tooltip } from '@lobehub/ui';
import { Dices } from 'lucide-react';
import { MAX_SEED } from 'model-bank';
import { type CSSProperties, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { generateUniqueSeeds } from '@/utils/number';

export interface SeedNumberInputProps {
  className?: string;
  onChange: (value: number | null | undefined) => void;
  placeholder?: string;
  style?: CSSProperties;
  value?: number | null;
}

const SeedNumberInput = memo<SeedNumberInputProps>(
  ({ value, onChange, style, className, ...rest }) => {
    const { t } = useTranslation('image');

    const handleClick = useCallback(() => {
      const randomSeed = generateUniqueSeeds(1)[0];
      onChange?.(randomSeed);
    }, [onChange]);

    return (
      <Flexbox className={className} gap={4} horizontal style={style}>
        <InputNumber
          max={MAX_SEED}
          min={0}
          onChange={onChange as any}
          placeholder={t('config.seed.random')}
          step={1}
          style={{ width: '100%' }}
          value={value}
          {...rest}
        />
        <Tooltip title={t('config.seed.random')}>
          <Button
            icon={Dices}
            onClick={handleClick}
            style={{ flex: 'none', width: 48 }}
            variant={'outlined'}
          />
        </Tooltip>
      </Flexbox>
    );
  },
);

export default SeedNumberInput;
