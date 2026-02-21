import { type InputProps } from '@lobehub/ui';
import { ActionIcon, Button, Flexbox, Input } from '@lobehub/ui';
import { Plus, X } from 'lucide-react';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface ArgsInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  onChange?: (value: string[]) => void;
  value?: string[];
}

const ArgsInput = memo<ArgsInputProps>(({ value = [], onChange, ...res }) => {
  const { t } = useTranslation('components');

  const handleAddArg = useCallback(() => {
    onChange?.([...value, '']);
  }, [value, onChange]);

  const handleRemoveArg = useCallback(
    (index: number) => {
      const newValue = value.filter((_, i) => i !== index);
      onChange?.(newValue);
    },
    [value, onChange],
  );

  const handleArgChange = useCallback(
    (index: number, newArg: string) => {
      const newValue = [...value];
      newValue[index] = newArg;
      onChange?.(newValue);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (index === value.length - 1) {
          handleAddArg();
        }
      } else if (e.key === 'Backspace' && e.currentTarget.value === '' && value.length > 1) {
        e.preventDefault();
        handleRemoveArg(index);
      }
    },
    [value.length, handleAddArg, handleRemoveArg],
  );

  return (
    <Flexbox gap={8} style={{ width: '100%' }}>
      {value.length === 0 ? (
        <Flexbox horizontal align="center" gap={8}>
          <Input
            {...res}
            placeholder={t('ArgsInput.enterFirstArgument')}
            style={{ flex: 1 }}
            onBlur={(e) => {
              if (e.target.value.trim()) {
                onChange?.([e.target.value.trim()]);
              }
              res.onBlur?.(e);
            }}
          />
          <Button icon={Plus} size="small" type="primary" onClick={handleAddArg} />
        </Flexbox>
      ) : (
        <>
          {value.map((arg, index) => (
            <Flexbox horizontal align="center" gap={8} key={index}>
              <Input
                placeholder={t('ArgsInput.argumentPlaceholder', { index: index + 1 })}
                style={{ flex: 1 }}
                value={arg}
                onChange={(e) => handleArgChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
              />
              <ActionIcon
                icon={X}
                size="small"
                style={{ flexShrink: 0 }}
                onClick={() => handleRemoveArg(index)}
              />
            </Flexbox>
          ))}
          <Button
            icon={Plus}
            size="small"
            style={{ alignSelf: 'flex-start' }}
            type="dashed"
            onClick={handleAddArg}
          >
            {t('ArgsInput.addArgument')}
          </Button>
        </>
      )}
    </Flexbox>
  );
});

export default ArgsInput;
