'use client';

import { ActionIcon, Flexbox, Text, TooltipGroup } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { ToggleRightIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import ModelItem from './ModelItem';

const SearchResult = memo(() => {
  const { t } = useTranslation('modelProvider');

  const searchKeyword = useAiInfraStore((s) => s.modelSearchKeyword);
  const batchToggleAiModels = useAiInfraStore((s) => s.batchToggleAiModels);

  const filteredModels = useAiInfraStore(aiModelSelectors.filteredAiProviderModelList, isEqual);

  const [batchLoading, setBatchLoading] = useState(false);

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
              size={'small'}
              title={t('providerModels.list.enabledActions.enableAll')}
              onClick={async () => {
                setBatchLoading(true);
                await batchToggleAiModels(
                  filteredModels.map((i) => i.id),
                  true,
                );
                setBatchLoading(false);
              }}
            />
          </Flexbox>
        )}
      </Flexbox>

      {searchKeyword && isEmpty ? (
        <Flexbox align="center" justify="center" padding={16}>
          {t('providerModels.searchNotFound')}
        </Flexbox>
      ) : (
        <TooltipGroup>
          <Flexbox gap={4}>
            {filteredModels.map((item) => (
              <ModelItem {...item} key={`${item.id}-${item.enabled}`} />
            ))}
          </Flexbox>
        </TooltipGroup>
      )}
    </>
  );
});

export default SearchResult;
