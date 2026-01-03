import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PluginTag from '@/components/Plugins/PluginTag';
import { type DiscoverPluginItem } from '@/types/discover';
import { type LobeToolType } from '@/types/tool/tool';

import Actions from './Action';

interface PluginItemProps extends DiscoverPluginItem {
  active?: boolean;
  onClick?: () => void;
  runtimeType?: 'mcp' | 'default' | 'markdown' | 'standalone' | undefined;
  type: LobeToolType;
}

const Item = memo<PluginItemProps>(
  ({ title, description, avatar, onClick, active, identifier, author, runtimeType, type }) => {
    const isMCP = runtimeType === 'mcp';

    return (
      <Block
        align={'center'}
        clickable
        gap={8}
        horizontal
        justify={'space-between'}
        onClick={onClick}
        paddingBlock={8}
        paddingInline={12}
        style={{ position: 'relative' }}
        variant={active ? 'filled' : 'borderless'}
      >
        <Flexbox
          align={'center'}
          flex={1}
          gap={8}
          horizontal
          style={{ overflow: 'hidden', position: 'relative' }}
        >
          <PluginAvatar avatar={avatar} />
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden', position: 'relative' }}>
            <Flexbox align={'center'} gap={4} horizontal>
              <Text ellipsis strong>
                {title}
              </Text>
              <PluginTag author={author} isMCP={isMCP} type={type!} />
            </Flexbox>
            <Text ellipsis fontSize={12} type={'secondary'}>
              {description}
            </Text>
          </Flexbox>
        </Flexbox>
        <Actions identifier={identifier} isMCP={isMCP} type={type!} />
      </Block>
    );
  },
);

export default Item;
