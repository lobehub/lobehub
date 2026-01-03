import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { PluginStoreTabs } from '@/store/tool/slices/oldStore';

export const Search = memo(() => {
  const { t } = useTranslation('plugin');
  const [listType, mcpKeywords, pluginKeywords] = useToolStore((s) => [
    s.listType,
    s.mcpSearchKeywords,
    s.pluginSearchKeywords,
  ]);

  // 根据当前选项卡决定使用哪个关键词
  const keywords = listType === PluginStoreTabs.MCP ? mcpKeywords : pluginKeywords;

  return (
    <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
      <Flexbox flex={1}>
        <SearchBar
          allowClear
          defaultValue={keywords}
          onSearch={(keywords: string) => {
            if (listType === PluginStoreTabs.MCP) {
              useToolStore.setState({ mcpSearchKeywords: keywords, searchLoading: true });
            } else if (listType === PluginStoreTabs.Plugin) {
              useToolStore.setState({ pluginSearchKeywords: keywords, pluginSearchLoading: true });
            }
          }}
          placeholder={t('store.placeholder')}
          variant={'borderless'}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default Search;
