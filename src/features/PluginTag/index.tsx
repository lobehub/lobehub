'use client';

import { type MenuProps } from '@lobehub/ui';
import { Center, DropdownMenu, Icon, Tag } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { LucideToyBrick } from 'lucide-react';
import { memo } from 'react';

import Avatar from '@/components/Plugins/PluginAvatar';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import PluginStatus from './PluginStatus';

export interface PluginTagProps {
  plugins: string[];
}

const PluginTag = memo<PluginTagProps>(({ plugins }) => {
  const list = useToolStore(toolSelectors.metaList, isEqual);

  const displayPlugin = useToolStore(toolSelectors.getMetaById(plugins[0]), isEqual);

  if (plugins.length === 0) return null;

  const items: MenuProps['items'] = plugins.map((id) => {
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
  });

  const count = plugins.length;

  return (
    <DropdownMenu items={items}>
      <div>
        <Tag>
          {<Icon icon={LucideToyBrick} />}
          {pluginHelpers.getPluginTitle(displayPlugin) || plugins[0]}
          {count > 1 && <div>({plugins.length - 1}+)</div>}
        </Tag>
      </div>
    </DropdownMenu>
  );
});

export default PluginTag;
