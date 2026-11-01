import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProviderIcon } from '@/components/LobeIcons';
import { type DiscoverModelDetailProviderItem } from '@/types/discover';

const styles = stylex.create({
  desc: { flex: '1', margin: '0', fontSize: '14px', color: cssVar.colorTextSecondary },
  title: {
    margin: '0',
    fontSize: '14px',
    fontWeight: 500,
    color: { 'default': null, ':hover': cssVar.colorLink },
  },
});

const RelatedItem = memo<DiscoverModelDetailProviderItem>(({ description, id, name }) => {
  const { t } = useTranslation('providers');
  return (
    <Block horizontal gap={12} key={id} padding={12} variant={'outlined'}>
      <ProviderIcon provider={id} size={40} style={{ flex: 'none' }} type={'avatar'} />
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
          {description && t(`${id}.description`, { defaultValue: description })}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default RelatedItem;
