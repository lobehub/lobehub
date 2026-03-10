import { type FC } from 'react';

import InstantSwitch from '@/components/InstantSwitch';
import { useAiInfraStore } from '@/store/aiInfra';

interface SwitchProps {
  Component?: FC<{ enabled: boolean; id: string }>;
  enabled: boolean;
  id: string;
}

const Switch = ({ id, Component, enabled }: SwitchProps) => {
  const [toggleProviderEnabled] = useAiInfraStore((s) => [s.toggleProviderEnabled]);

  // slot for cloud
  if (Component) return <Component enabled={enabled} id={id} />;

  return (
    <InstantSwitch
      enabled={enabled}
      size={'small'}
      onChange={async (checked) => {
        await toggleProviderEnabled(id, checked);
      }}
    />
  );
};

export default Switch;
