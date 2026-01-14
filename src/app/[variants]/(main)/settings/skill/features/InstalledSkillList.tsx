'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import PluginItem from '@/features/PluginStore/InstalledList/List/Item';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

const InstalledSkillList = memo(() => {
  const installedPlugins = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);

  useFetchInstalledPlugins();

  if (installedPlugins.length === 0) {
    return null;
  }

  return (
    <Flexbox gap={4}>
      {installedPlugins.map((item) => (
        <PluginItem
          author={item.author || ''}
          avatar={item.avatar || ''}
          createdAt={item.createdAt || ''}
          description={item.description || ''}
          homepage={item.homepage || ''}
          identifier={item.identifier}
          key={item.identifier}
          manifest={undefined as any}
          runtimeType={item.runtimeType}
          schemaVersion={1}
          title={item.title || item.identifier}
          type={item.type as LobeToolType}
        />
      ))}
    </Flexbox>
  );
});

InstalledSkillList.displayName = 'InstalledSkillList';

export default InstalledSkillList;
