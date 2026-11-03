import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelIcon } from '@/components/LobeIcons';
import { type DiscoverModelItem } from '@/types/discover';

const styles = stylex.create({
  desc: { flex: '1', margin: '0', fontSize: '14px', color: cssVar.colorTextSecondary },
  title: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
});

const RelatedItem = memo<DiscoverModelItem>(({ description, identifier, displayName }) => {
  const { t } = useTranslation('models');
  return (
    <Block horizontal gap={12} key={identifier} padding={12} variant={'outlined'}>
      <ModelIcon model={identifier} size={40} style={{ flex: 'none' }} type={'avatar'} />
      <Flexbox
        flex={1}
        gap={6}
        style={{
          overflow: 'hidden',
        }}
      >
        <Text ellipsis as={'h2'} className={stylex.props(styles.title).className}>
          {displayName || identifier}
        </Text>
        <Text
          as={'p'}
          className={stylex.props(styles.desc).className}
          ellipsis={{
            rows: 2,
          }}
        >
          {t(`${identifier}.description`, { defaultValue: description })}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default RelatedItem;
