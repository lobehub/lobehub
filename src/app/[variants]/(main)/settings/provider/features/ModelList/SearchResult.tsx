'use client';

import { ActionIcon, Text } from '@lobehub/ui';
import { ToggleRightIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Virtuoso } from 'react-virtuoso';
import { useShallow } from 'zustand/react/shallow';

import { useAiInfraStore } from '@/store/aiInfra';

import ModelItem from './ModelItem';
import { useModelListVirtualConfig } from './useModelListVirtualConfig';

const SearchResult = memo(() => {
  const { t } = useTranslation('modelProvider');
  const { aiProviderModelList, searchKeyword } = useAiInfraStore(
    useShallow((s) => ({
      aiProviderModelList: s.aiProviderModelList,
      searchKeyword: s.modelSearchKeyword,
    })),
  );
  const batchToggleAiModels = useAiInfraStore((s) => s.batchToggleAiModels);

  const normalizedKeyword = useMemo(
    () => (searchKeyword ? searchKeyword.trim().toLowerCase() : ''),
    [searchKeyword],
  );

  const filteredModels = useMemo(() => {
    if (!normalizedKeyword) return aiProviderModelList;

    return aiProviderModelList.filter((model) => {
      const id = model.id.toLowerCase();
      const name = model.displayName?.toLowerCase() ?? '';

      return id.includes(normalizedKeyword) || name.includes(normalizedKeyword);
    });
  }, [aiProviderModelList, normalizedKeyword]);

  const [batchLoading, setBatchLoading] = useState(false);

  const filteredLength = filteredModels.length;

  const { increaseViewportBy, itemGap, itemSize, overscan, virtualListHeight } =
    useModelListVirtualConfig(filteredLength);

  const renderVirtualItem = useCallback(
    (index: number, item: (typeof filteredModels)[number]) => (
      <div style={{ paddingBottom: itemGap }}>
        <ModelItem {...item} />
      </div>
    ),
    [itemGap],
  );

  const isEmpty = filteredModels.length === 0;
  return (
    <>
      <Flexbox horizontal justify={'space-between'}>
        <Text style={{ fontSize: 12, marginTop: 8 }} type={'secondary'}>
          {t('providerModels.list.searchResult', { count: filteredModels.length })}
        </Text>
        {!isEmpty && (
          <Flexbox horizontal>
            <ActionIcon
              icon={ToggleRightIcon}
              loading={batchLoading}
              onClick={async () => {
                setBatchLoading(true);
                await batchToggleAiModels(
                  filteredModels.map((i) => i.id),
                  true,
                );
                setBatchLoading(false);
              }}
              size={'small'}
              title={t('providerModels.list.enabledActions.enableAll')}
            />
          </Flexbox>
        )}
      </Flexbox>

      {searchKeyword && isEmpty ? (
        <Flexbox align="center" justify="center" padding={16}>
          {t('providerModels.searchNotFound')}
        </Flexbox>
      ) : (
        <Flexbox gap={4}>
          <div style={{ height: virtualListHeight }}>
            <Virtuoso
              computeItemKey={(_, item) => item.id}
              data={filteredModels}
              defaultItemHeight={itemSize}
              fixedItemHeight={itemSize}
              increaseViewportBy={increaseViewportBy}
              itemContent={renderVirtualItem}
              overscan={overscan}
            />
          </div>
        </Flexbox>
      )}
    </>
  );
});

export default SearchResult;
