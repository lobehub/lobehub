import { Flexbox } from '@lobehub/ui';
import { Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { useToolStore } from '@/store/tool';

import { useStore } from '../../store';

const PluginSwitch = memo<{ identifier: string }>(({ identifier }) => {
  const pluginManifestLoading = useToolStore((s) => s.pluginInstallLoading, isEqual);
  const [userEnabledPlugins, hasPlugin, toggleAgentPlugin] = useStore((s) => [
    s.config.plugins || [],
    !!s.config.plugins,
    s.toggleAgentPlugin,
  ]);

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        loading={pluginManifestLoading[identifier]}
        checked={
          // 如果在加载中，说明激活了
          pluginManifestLoading[identifier] || !hasPlugin
            ? false
            : userEnabledPlugins.includes(identifier)
        }
        onChange={() => {
          toggleAgentPlugin(identifier);
        }}
      />
    </Flexbox>
  );
});

export default PluginSwitch;
