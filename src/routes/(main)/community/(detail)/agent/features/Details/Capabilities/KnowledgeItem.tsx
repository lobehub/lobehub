import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

const styles = stylex.create({
  desc: { flex: '1', margin: '0', fontSize: '14px', color: cssVar.colorTextSecondary },
  title: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
});

const KnowledgeItem = memo<{ avatar?: string; description?: string; title: string }>(
  ({ avatar, title, description }) => {
    return (
      <Block horizontal gap={12} padding={12} variant={'outlined'}>
        <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
        <Flexbox
          flex={1}
          gap={6}
          style={{
            overflow: 'hidden',
          }}
        >
          <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
            {title}
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
  },
);

export default KnowledgeItem;
