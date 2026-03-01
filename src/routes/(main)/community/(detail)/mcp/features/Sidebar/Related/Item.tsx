import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { type DiscoverMcpItem } from '@/types/discover';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    desc: css`
      flex: 1;
      margin: 0 !important;
      font-size: 14px !important;
      color: ${cssVar.colorTextSecondary};
    `,
    title: css`
      margin: 0 !important;
      font-size: 14px !important;
      font-weight: 500 !important;

      &:hover {
        color: ${cssVar.colorLink};
      }
    `,
  };
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
        <Text ellipsis as={'h2'} className={styles.title}>
          {name}
        </Text>
        <Text
          as={'p'}
          className={styles.desc}
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
