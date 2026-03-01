'use client';

import { Flexbox, Grid, Tag, Text } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import Card from './Card';

const loadingArr = Array.from({ length: 12 })
  .fill('-')
  .map((item, index) => `${index}x${item}`);

type ListProps = {
  onProviderSelect: (provider: string) => void;
};

const List = memo((props: ListProps) => {
  const { onProviderSelect } = props;
  const { t } = useTranslation('modelProvider');
  const enabledList = useAiInfraStore(aiProviderSelectors.enabledAiProviderList, isEqual);
  const disabledList = useAiInfraStore(aiProviderSelectors.disabledAiProviderList, isEqual);
  const disabledCustomList = useAiInfraStore(
    aiProviderSelectors.disabledCustomAiProviderList,
    isEqual,
  );
  const [initAiProviderList] = useAiInfraStore((s) => [s.initAiProviderList]);

  if (!initAiProviderList)
    return (
      <Flexbox gap={24} paddingBlock={'0 16px'}>
        <Flexbox horizontal align={'center'} gap={4}>
          <Text strong style={{ fontSize: 16 }}>
            {t('list.title.enabled')}
          </Text>
        </Flexbox>
        <Grid gap={16} rows={3}>
          {loadingArr.map((item) => (
            <Card
              loading
              enabled={false}
              id={item}
              key={item}
              source={'builtin'}
              onProviderSelect={onProviderSelect}
            />
          ))}
        </Grid>
      </Flexbox>
    );

  return (
    <>
      <Flexbox gap={24}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text strong style={{ fontSize: 18 }}>
            {t('list.title.enabled')}
          </Text>
          <Tag>{enabledList.length}</Tag>
        </Flexbox>
        <Grid gap={16} rows={3}>
          {enabledList.map((item) => (
            <Card {...item} key={item.id} onProviderSelect={onProviderSelect} />
          ))}
        </Grid>
      </Flexbox>
      {disabledCustomList.length > 0 && (
        <Flexbox gap={24}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text strong style={{ fontSize: 18 }}>
              {t('list.title.custom')}
            </Text>
            <Tag>{disabledCustomList.length}</Tag>
          </Flexbox>
          <Grid gap={16} rows={3}>
            {disabledCustomList.map((item) => (
              <Card {...item} key={item.id} onProviderSelect={onProviderSelect} />
            ))}
          </Grid>
        </Flexbox>
      )}
      <Flexbox gap={24}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Text strong style={{ fontSize: 18 }}>
            {t('list.title.disabled')}
          </Text>
          <Tag>{disabledList.length}</Tag>
        </Flexbox>
        <Grid gap={16} rows={3}>
          {disabledList.map((item) => (
            <Card {...item} key={item.id} onProviderSelect={onProviderSelect} />
          ))}
        </Grid>
      </Flexbox>
    </>
  );
});

export default List;
