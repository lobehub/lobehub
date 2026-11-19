import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { densityTokens } from '@/styles/density.stylex';
import { type DiscoverMcpItem } from '@/types/discover';

const styles = stylex.create({
  desc: {
    flex: '1',
    margin: '0',
    fontSize: densityTokens['--lobe-density-font-size'],
    color: cssVar.colorTextSecondary,
  },
  title: {
    margin: '0',
    fontSize: densityTokens['--lobe-density-font-size'],
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
});

const RelatedItem = memo<DiscoverMcpItem>(({ name, icon, description, identifier }) => {
  return (
    <Block horizontal gap={12} key={identifier} padding={12} variant={'outlined'}>
      <Avatar avatar={icon} shape={'square'} size={40} style={{ flex: 'none' }} />
      <Flexbox
        flex={1}
        gap={6}
        style={{
          overflow: 'hidden',
        }}
      >
        <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
          {name}
        </Text>
        <Text
          as={'p'}
          className={stylex.props(styles.desc).className}
          ellipsis={{
            rows: 2,
          }}
        >
          {description}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default RelatedItem;
