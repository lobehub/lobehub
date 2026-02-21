'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import { SkillStoreTab } from '../SkillStoreContent';

interface SearchProps {
  activeTab: SkillStoreTab;
  onLobeHubSearch: (keywords: string) => void;
}

export const Search = memo<SearchProps>(({ activeTab, onLobeHubSearch }) => {
  const { t } = useTranslation('setting');
  const mcpKeywords = useToolStore((s) => s.mcpSearchKeywords);

  const isCustomTab = activeTab === SkillStoreTab.Custom;

  const keywords = activeTab === SkillStoreTab.Community ? mcpKeywords : '';

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
      <Flexbox flex={1}>
        <SearchBar
          allowClear
          defaultValue={keywords}
          placeholder={t('skillStore.search')}
          variant="outlined"
          onSearch={(keywords: string) => {
            if (activeTab === SkillStoreTab.Community) {
              useToolStore.setState({ mcpSearchKeywords: keywords, searchLoading: true });
            } else if (isCustomTab) {
              useToolStore.setState({ customPluginSearchKeywords: keywords });
            } else {
              onLobeHubSearch(keywords);
            }
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default Search;
