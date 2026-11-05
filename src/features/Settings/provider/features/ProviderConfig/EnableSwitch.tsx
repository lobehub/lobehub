import { Skeleton, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { type FC } from 'react';

import InstantSwitch from '@/components/InstantSwitch';
import { usePermission } from '@/hooks/usePermission';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

const styles = stylex.create({
  switchLoading: {
    width: '44px !important',
    minWidth: '44px !important',
    height: '22px !important',
    borderRadius: '12px !important',
  },
});

interface SwitchProps {
  Component?: FC<{ id: string }>;
  id: string;
}

const Switch = ({ id, Component }: SwitchProps) => {
  const [toggleProviderEnabled, enabled, isLoading] = useAiInfraStore((s) => [
    s.toggleProviderEnabled,
    aiProviderSelectors.isProviderEnabled(id)(s),
    aiProviderSelectors.isAiProviderConfigLoading(id)(s),
  ]);
  const { allowed: canManageProvider, reason } = usePermission('manage_provider_key');

  if (isLoading)
    return <Skeleton className={stylex.props(styles.switchLoading).className} height={36} />;

  // slot for cloud
  if (Component) return <Component id={id} />;

  const switchNode = (
    <InstantSwitch
      disabled={!canManageProvider}
      enabled={enabled}
      onChange={async (enabled) => {
        if (!canManageProvider) return;
        await toggleProviderEnabled(id as any, enabled);
      }}
    />
  );

  return canManageProvider ? switchNode : <Tooltip title={reason}>{switchNode}</Tooltip>;
};

export default Switch;
