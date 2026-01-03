import { ActionIcon, Button, Input, type InputProps } from '@lobehub/ui';
import { Flexbox } from '@lobehub/ui';
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
        <Flexbox align="center" gap={8} horizontal>
          <Input
            {...res}
            onBlur={(e) => {
              if (e.target.value.trim()) {
                onChange?.([e.target.value.trim()]);
              }
              res.onBlur?.(e);
            }}
            placeholder={t('ArgsInput.enterFirstArgument')}
            style={{ flex: 1 }}
          />
          <Button icon={Plus} onClick={handleAddArg} size="small" type="primary" />
        </Flexbox>
      ) : (
        <>
          {value.map((arg, index) => (
            <Flexbox align="center" gap={8} horizontal key={index}>
              <Input
                onChange={(e) => handleArgChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                placeholder={t('ArgsInput.argumentPlaceholder', { index: index + 1 })}
                style={{ flex: 1 }}
                value={arg}
              />
              <ActionIcon
                icon={X}
                onClick={() => handleRemoveArg(index)}
                size="small"
                style={{ flexShrink: 0 }}
              />
            </Flexbox>
          ))}
          <Button
            icon={Plus}
            onClick={handleAddArg}
            size="small"
            style={{ alignSelf: 'flex-start' }}
            type="dashed"
          >
            {t('ArgsInput.addArgument')}
          </Button>
        </>
      )}
    </Flexbox>
  );
});

export default ArgsInput;
