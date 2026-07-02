import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useToolStore } from '@/store/tool';

import { useStore } from '../../store';

const PluginSwitch = memo<{ identifier: string }>(({ identifier }) => {
  const pluginManifestLoading = useToolStore((s) => s.pluginInstallLoading, isEqual);
  const [userEnabledPlugins, hasPlugin, disabled, toggleAgentPlugin] = useStore((s) => [
    s.config.plugins || [],
    !!s.config.plugins,
    s.disabled,
    s.toggleAgentPlugin,
  ]);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        disabled={disabled}
        loading={pluginManifestLoading[identifier]}
        checked={
          // If loading, it means it's activated
          pluginManifestLoading[identifier] || !hasPlugin
            ? false
            : userEnabledPlugins.includes(identifier)
        }
        onChange={() => {
          if (disabled) return;

          toggleAgentPlugin(identifier);
        }}
      />
    </Flexbox>
  );
});

export default PluginSwitch;
