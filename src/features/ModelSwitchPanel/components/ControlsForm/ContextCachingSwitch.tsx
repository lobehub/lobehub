import { Switch } from 'antd';
import { memo } from 'react';

interface ContextCachingSwitchProps {
  disabled?: boolean;
  onChange?: (value: boolean) => void;
  value?: boolean;
}

const ContextCachingSwitch = memo<ContextCachingSwitchProps>(({ disabled, value, onChange }) => {
  return (
    <Switch
      disabled={disabled}
      size={'small'}
      value={!value}
      onChange={(checked) => {
        onChange?.(!checked);
      }}
    />
  );
});

export default ContextCachingSwitch;
