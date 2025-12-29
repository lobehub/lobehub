import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import MetaInfo from '@/app/[variants]/(main)/community/(list)/mcp/features/List/MetaInfo';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { type DiscoverMcpItem } from '@/types/discover';

const FeaturedPluginItem = memo<DiscoverMcpItem>(({ name, icon, github, installCount }) => {
  return (
    <Block
      clickable
      flex={'none'}
      gap={12}
      height={RECENT_BLOCK_SIZE.PLUGIN.HEIGHT}
      horizontal
      padding={12}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        overflow: 'hidden',
        width: '100%',
      }}
      variant={'outlined'}
    >
      {/* Left side - Icon */}
      <Avatar
        avatar={icon}
        emojiScaleWithBackground
        shape={'square'}
        size={40}
        style={{
          background: 'transparent',
          flex: 'none',
        }}
      />

      {/* Right side - Content */}
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        {/* Title and Tags */}
        <Flexbox align={'center'} gap={8} horizontal>
          <Text ellipsis fontSize={13} weight={500}>
            {name}
          </Text>
        </Flexbox>
        <MetaInfo
          installCount={installCount}
          stars={github?.stars}
          style={{
            color: cssVar.colorTextDescription,
            fontSize: 12,
          }}
        />
      </Flexbox>
    </Block>
  );
});

export default FeaturedPluginItem;
