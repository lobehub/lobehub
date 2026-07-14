import { getActivePluginIds } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import { useStore } from '../store';

const MarketList = memo<{ id: string }>(({ id }) => {
  const [toggleAgentPlugin, hasPlugin, disabled] = useStore((s) => [
    s.toggleAgentPlugin,
    !!s.config.plugins,
    s.disabled,
  ]);
  const plugins = useStore((s) => getActivePluginIds(s.config.plugins));

  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <Switch
        checked={!hasPlugin ? false : plugins.includes(id)}
        disabled={disabled}
        onChange={() => {
          if (disabled) return;

          toggleAgentPlugin(id);
        }}
      />
    </Flexbox>
  );
});

export default MarketList;
