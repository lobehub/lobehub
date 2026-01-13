import { ActionIcon, Select, type SelectProps } from '@lobehub/ui';
import { isString } from 'es-toolkit/compat';
import { Wand2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

export interface AutoGenerateInputProps extends SelectProps {
  canAutoGenerate?: boolean;
  loading?: boolean;
  onGenerate?: () => void;
}

const AutoGenerateSelect = memo<AutoGenerateInputProps>(
  ({ loading, onGenerate, value, canAutoGenerate, onChange, ...props }) => {
    const { t } = useTranslation('common');

    return (
      <Select
        mode="tags"
        onChange={(v) => {
          onChange?.(isString(v) ? v.split(',') : v);
        }}
        open={false}
        style={{ width: '100%' }}
        suffixIcon={
          onGenerate && (
            <ActionIcon
              disabled={!canAutoGenerate}
              icon={Wand2}
              loading={loading}
              onClick={onGenerate}
              size={'small'}
              style={{
                marginRight: -4,
              }}
              title={!canAutoGenerate ? t('autoGenerateTooltipDisabled') : t('autoGenerate')}
            />
          )
        }
        tokenSeparators={[',', '，', ' ']}
        value={isString(value) ? value.split(',') : value}
        {...props}
      />
    );
  },
);

export default AutoGenerateSelect;
