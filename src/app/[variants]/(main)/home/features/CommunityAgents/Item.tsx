import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar, useThemeMode } from 'antd-style';
import { memo } from 'react';

import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { DEFAULT_AVATAR } from '@/const/meta';
import { type DiscoverAssistantItem } from '@/types/discover';

const CommunityAgentItem = memo<DiscoverAssistantItem>(
  ({ title, avatar, backgroundColor, author, description }) => {
    const { isDarkMode } = useThemeMode();

    return (
      <Block
        clickable
        flex={'none'}
        height={RECENT_BLOCK_SIZE.AGENT.HEIGHT}
        justify={'space-between'}
        style={{
          backgroundColor: cssVar.colorFillQuaternary,
          borderRadius: cssVar.borderRadiusLG,
          overflow: 'hidden',
        }}
        variant={'filled'}
        width={RECENT_BLOCK_SIZE.AGENT.WIDTH}
      >
        <Block
          flex={1}
          padding={12}
          style={{
            backgroundColor: isDarkMode ? cssVar.colorFillQuaternary : cssVar.colorBgContainer,
            borderRadius: cssVar.borderRadiusLG,
            boxShadow: '0 4px 8px -2px rgba(0,0,0,.02)',
            overflow: 'hidden',
          }}
          variant={'outlined'}
        >
          <Text color={cssVar.colorTextSecondary} ellipsis={{ rows: 3 }} fontSize={13}>
            {description}
          </Text>
        </Block>
        <Flexbox align={'center'} gap={8} horizontal paddingBlock={8} paddingInline={12}>
          <Flexbox
            flex={1}
            gap={1}
            style={{
              overflow: 'hidden',
            }}
          >
            <Text ellipsis fontSize={13} weight={500}>
              {title}
            </Text>
            <Text ellipsis fontSize={12} type={'secondary'}>
              {author}
            </Text>
          </Flexbox>
          <Avatar
            avatar={avatar || DEFAULT_AVATAR}
            background={backgroundColor || undefined}
            emojiScaleWithBackground
            shape={'square'}
            size={30}
            style={{
              flex: 'none',
            }}
          />
        </Flexbox>
      </Block>
    );
  },
);

export default CommunityAgentItem;
