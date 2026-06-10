import { type FC } from 'react';

import InstantSwitch from '@/components/InstantSwitch';
import { usePermission } from '@/hooks/usePermission';
import { useAiInfraStore } from '@/store/aiInfra';

interface SwitchProps {
  Component?: FC<{ enabled: boolean; id: string }>;
  enabled: boolean;
  id: string;
}

const Switch = ({ id, Component, enabled }: SwitchProps) => {
  const { allowed: canManageProvider } = usePermission('manage_provider_key');
  const [toggleProviderEnabled] = useAiInfraStore((s) => [s.toggleProviderEnabled]);

  // slot for cloud
  if (Component) return <Component enabled={enabled} id={id} />;

  return (
    <InstantSwitch
      disabled={!canManageProvider}
      enabled={enabled}
      size={'small'}
      onChange={async (checked) => {
        if (!canManageProvider) return;
        await toggleProviderEnabled(id, checked);
      }}
    />
  );
};

export default Switch;
