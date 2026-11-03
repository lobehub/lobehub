'use client';

import { Center, DropdownMenu, Icon, Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LucideToyBrick } from 'lucide-react';
import { memo, useMemo } from 'react';

import Avatar from '@/components/Plugins/PluginAvatar';
import { filterToolIdsByCurrentEnv } from '@/helpers/toolAvailability';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors, toolSelectors } from '@/store/tool/selectors';

import PluginStatus from './PluginStatus';

export interface PluginTagProps {
  plugins: string[];
}

const PluginTag = memo<PluginTagProps>(({ plugins }) => {
  const list = useToolStore(toolSelectors.metaList, isEqual);
  const installedPlugins = useToolStore(pluginSelectors.installedPlugins, isEqual);

  const visiblePlugins = useMemo(
    () => filterToolIdsByCurrentEnv(plugins, { installedPlugins }),
    [installedPlugins, plugins],
  );

  const displayPlugin = useToolStore(toolSelectors.getMetaById(visiblePlugins[0] || ''), isEqual);

  if (visiblePlugins.length === 0) return null;

  const count = visiblePlugins.length;

  return (
    <DropdownMenu
      items={() =>
        visiblePlugins.map((id) => {
          const item = list.find((i) => i.identifier === id);

          const isDeprecated = !item;
          const avatar = isDeprecated ? '♻️' : pluginHelpers.getPluginAvatar(item.meta || item);

          return {
            icon: (
              <Center style={{ minWidth: 24 }}>
                <Avatar avatar={avatar} size={24} />
              </Center>
            ),
            key: id,
            label: (
              <PluginStatus
                deprecated={isDeprecated}
                id={id}
                title={pluginHelpers.getPluginTitle(item?.meta || item)}
              />
            ),
          };
        })
      }
    >
      <Tag style={{ cursor: 'pointer' }}>
        {<Icon icon={LucideToyBrick} />}
        {pluginHelpers.getPluginTitle(displayPlugin) || visiblePlugins[0]}
        {count > 1 && <div>({visiblePlugins.length - 1}+)</div>}
      </Tag>
    </DropdownMenu>
  );
});

export default PluginTag;
