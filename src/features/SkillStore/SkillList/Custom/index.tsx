'use client';

import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

import Empty from '../Empty';
import { gridStyles } from '../style';
import Item from './Item';

export const CustomList = memo(() => {
  const customPlugins = useToolStore(pluginSelectors.installedCustomPluginMetaList, isEqual);
  const searchKeywords = useToolStore((s) => s.customPluginSearchKeywords || '');

  const filteredItems = useMemo(() => {
    const lowerKeywords = searchKeywords.toLowerCase().trim();
    if (!lowerKeywords) return customPlugins;

    return customPlugins.filter((plugin) => {
      const title = plugin.title?.toLowerCase() || '';
      const identifier = plugin.identifier?.toLowerCase() || '';
      return title.includes(lowerKeywords) || identifier.includes(lowerKeywords);
    });
  }, [customPlugins, searchKeywords]);

  const hasSearchKeywords = Boolean(searchKeywords && searchKeywords.trim());

  if (filteredItems.length === 0) {
    return <Empty search={hasSearchKeywords} />;
  }

  return (
    <div className={gridStyles.grid}>
      {filteredItems.map((plugin) => (
        <Item
          avatar={plugin.avatar}
          description={plugin.description}
          identifier={plugin.identifier}
          key={plugin.identifier}
          title={plugin.title}
        />
      ))}
    </div>
  );
});

CustomList.displayName = 'CustomList';

export default CustomList;
