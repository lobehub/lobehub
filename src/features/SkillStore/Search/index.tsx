'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import { SkillStoreTab } from '../Content';

interface SearchProps {
  activeTab: SkillStoreTab;
  onLobeHubSearch: (keywords: string) => void;
}

export const Search = memo<SearchProps>(({ activeTab, onLobeHubSearch }) => {
  const { t } = useTranslation('setting');
  const mcpKeywords = useToolStore((s) => s.mcpSearchKeywords);

  const keywords = activeTab === SkillStoreTab.Community ? mcpKeywords : '';

  return (
    <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
      <Flexbox flex={1}>
        <SearchBar
          allowClear
          defaultValue={keywords}
          onSearch={(keywords: string) => {
            if (activeTab === SkillStoreTab.Community) {
              useToolStore.setState({ mcpSearchKeywords: keywords, searchLoading: true });
            } else {
              onLobeHubSearch(keywords);
            }
          }}
          placeholder={t('skillStore.search')}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default Search;
