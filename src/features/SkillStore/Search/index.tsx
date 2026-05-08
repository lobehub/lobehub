'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import { SkillStoreTab } from '../SkillStoreContent';

interface SearchProps {
  activeTab: SkillStoreTab;
  onLobeHubSearch: (keywords: string) => void;
  onSkillSearch: (keywords: string) => void;
}

export const Search = memo<SearchProps>(({ activeTab, onLobeHubSearch, onSkillSearch }) => {
  const { t } = useTranslation('setting');
  const mcpKeywords = useToolStore((s) => s.mcpSearchKeywords);

  const keywords = activeTab === SkillStoreTab.MCP ? mcpKeywords : '';

  return (
    <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
      <Flexbox flex={1}>
        <SearchBar
          allowClear
          defaultValue={keywords}
          placeholder={t('skillStore.search')}
          variant="outlined"
          onSearch={(keywords: string) => {
            if (activeTab === SkillStoreTab.MCP) {
              useToolStore.setState({ mcpSearchKeywords: keywords, searchLoading: true });
            } else if (activeTab === SkillStoreTab.Skills) {
              onSkillSearch(keywords);
            } else if (activeTab === SkillStoreTab.Custom) {
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
