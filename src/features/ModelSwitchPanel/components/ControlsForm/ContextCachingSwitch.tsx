import { Switch } from 'antd';
import { memo } from 'react';

interface ContextCachingSwitchProps {
  onChange?: (value: boolean) => void;
  value?: boolean;
}

const ContextCachingSwitch = memo<ContextCachingSwitchProps>(({ value, onChange }) => {
  return (
    <Switch
      value={!value}
      onChange={(checked) => {
        onChange?.(!checked);
      }}
    />
  );
});

export default ContextCachingSwitch;
