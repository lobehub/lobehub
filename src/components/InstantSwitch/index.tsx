import { Switch, type SwitchProps } from 'antd';
import { memo, useState } from 'react';

interface InstantSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  size?: SwitchProps['size'];
}

const InstantSwitch = memo<InstantSwitchProps>(({ enabled, onChange, size }) => {
  const [value, setValue] = useState(enabled);
  const [loading, setLoading] = useState(false);
  return (
    <Switch
      loading={loading}
      onChange={async (enabled) => {
        setLoading(true);
        setValue(enabled);
        await onChange(enabled);
        setLoading(false);
      }}
      size={size}
      value={value}
    />
  );
});

export default InstantSwitch;
