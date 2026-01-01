import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import PluginEmpty from '../../PluginEmpty';
import PluginItem from './Item';

interface ListProps {
  identifier?: string;
  keywords?: string;
  setIdentifier?: (props: {
    identifier?: string;
    runtimeType: 'mcp' | 'default';
    type?: LobeToolType;
  }) => void;
}

export const List = memo<ListProps>(({ keywords, identifier, setIdentifier }) => {
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  const filteredPluginList = useMemo(
    () =>
      installedPlugins.filter((item) =>
        [item?.title, item?.description, item.author, ...(item?.tags || [])]
          .filter(Boolean)
          .join('')
          .toLowerCase()
          .includes((keywords || '')?.toLowerCase()),
      ),
    [installedPlugins, keywords],
  );

  const isEmpty = installedPlugins.length === 0;
  const hasSearchKeywords = Boolean(keywords && keywords.trim());

  if (isEmpty) return <PluginEmpty search={hasSearchKeywords} />;

  return (
    <Virtuoso
      data={filteredPluginList}
      increaseViewportBy={typeof window !== 'undefined' ? window.innerHeight : 0}
      itemContent={(_, item) => {
        return (
          <Flexbox
            key={item.identifier}
            onClick={() => {
              setIdentifier?.({
                identifier: item.identifier,
                runtimeType: item.runtimeType as any,
                type: item.type,
              });
            }}
            paddingBlock={2}
            paddingInline={4}
          >
            <PluginItem active={identifier === item.identifier} {...(item as any)} />
          </Flexbox>
        );
      }}
      overscan={24}
      style={{ height: '100%', width: '100%' }}
      totalCount={filteredPluginList.length}
    />
  );
});

export default List;
