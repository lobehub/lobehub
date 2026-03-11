import { ModelIcon } from '@lobehub/icons';
import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DiscoverModelItem } from '@/types/discover';

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

const RelatedItem = memo<DiscoverModelItem>(({ identifier, displayName }) => {
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
        <Text ellipsis as={'h2'} className={styles.title}>
          {displayName || identifier}
        </Text>
        <Text
          as={'p'}
          className={styles.desc}
          ellipsis={{
            rows: 2,
          }}
        >
          {t(`${identifier}.description`)}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default RelatedItem;
