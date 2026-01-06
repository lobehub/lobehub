import { ActionIcon, Input, type InputProps } from '@lobehub/ui';
import { Wand2 } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface AutoGenerateInputProps extends Omit<InputProps, 'onChange'> {
  canAutoGenerate?: boolean;
  loading?: boolean;
  onChange?: (value: string) => void;
  onGenerate?: () => void;
  value?: string | any;
}

const AutoGenerateInput = memo<AutoGenerateInputProps>(
  ({ loading, value, onChange, onGenerate, canAutoGenerate, ...props }) => {
    const { t } = useTranslation('common');

    const [input, setInput] = useState<string>(value || '');

    const isChineseInput = useRef(false);
    const isFocusing = useRef(false);

    const updateValue = useCallback(() => {
      onChange?.(input);
    }, [input]);

    useEffect(() => {
      if (value !== undefined) setInput(value);
    }, [value]);

    return (
      <Input
        suffix={
          onGenerate && (
            <ActionIcon
              disabled={!canAutoGenerate}
              icon={Wand2}
              loading={loading}
              onClick={onGenerate}
              size="small"
              style={{
                marginRight: -4,
              }}
              title={!canAutoGenerate ? t('autoGenerateTooltipDisabled') : t('autoGenerate')}
            />
          )
        }
        {...props}
        onBlur={() => {
          updateValue();
          isFocusing.current = false;
        }}
        onChange={(e) => {
          setInput(e.target.value);
        }}
        onCompositionEnd={() => {
          isChineseInput.current = false;
        }}
        onCompositionStart={() => {
          isChineseInput.current = true;
        }}
        onFocus={() => {
          isFocusing.current = true;
        }}
        onPressEnter={(e) => {
          if (!e.shiftKey && !isChineseInput.current) {
            e.preventDefault();
            updateValue();
            isFocusing.current = false;
          }
        }}
        value={input}
      />
    );
  },
);

export default AutoGenerateInput;
