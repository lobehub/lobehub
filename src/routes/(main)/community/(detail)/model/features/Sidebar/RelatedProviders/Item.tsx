import { ProviderIcon } from '@lobehub/icons';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DiscoverModelDetailProviderItem } from '@/types/discover';

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

const RelatedItem = memo<DiscoverModelDetailProviderItem>(({ id, name }) => {
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
          {t(`${id}.description`)}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default RelatedItem;
