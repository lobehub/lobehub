import type { SwitchProps } from '@lobehub/ui';
import { Switch } from '@lobehub/ui';
import { memo, useState } from 'react';

interface InstantSwitchProps {
  disabled?: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  size?: SwitchProps['size'];
}

const InstantSwitch = memo<InstantSwitchProps>(({ disabled, enabled, onChange, size }) => {
  const [value, setValue] = useState(enabled);
  const [loading, setLoading] = useState(false);
  return (
    <Switch
      disabled={disabled}
      loading={loading}
      size={size}
      value={value}
      onChange={async (enabled) => {
        setLoading(true);
        setValue(enabled);
        try {
          await onChange(enabled);
        } catch {
          // The save failed, so the switch shows what is still stored; the
          // caller reports the failure.
          setValue(!enabled);
        } finally {
          setLoading(false);
        }
      }}
    />
  );
});

export default InstantSwitch;
