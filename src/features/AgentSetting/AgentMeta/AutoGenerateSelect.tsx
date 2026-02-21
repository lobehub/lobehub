import { type SelectProps } from '@lobehub/ui';
import { ActionIcon, Select } from '@lobehub/ui';
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
        open={false}
        style={{ width: '100%' }}
        tokenSeparators={[',', '，', ' ']}
        value={isString(value) ? value.split(',') : value}
        suffixIcon={
          onGenerate && (
            <ActionIcon
              disabled={!canAutoGenerate}
              icon={Wand2}
              loading={loading}
              size={'small'}
              title={!canAutoGenerate ? t('autoGenerateTooltipDisabled') : t('autoGenerate')}
              style={{
                marginRight: -4,
              }}
              onClick={onGenerate}
            />
          )
        }
        onChange={(v) => {
          onChange?.(isString(v) ? v.split(',') : v);
        }}
        {...props}
      />
    );
  },
);

export default AutoGenerateSelect;
