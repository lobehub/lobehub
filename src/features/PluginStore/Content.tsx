import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { PluginStoreTabs } from '@/store/tool/slices/oldStore';

import AddPluginButton from './AddPluginButton';
import InstalledList from './InstalledList';
import McpList from './McpList';
import PluginList from './PluginList';
import Search from './Search';

export const Content = memo(() => {
  const { t } = useTranslation('plugin');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [listType] = useToolStore((s) => [s.listType]);
  const [keywords] = useState<string>();

  const options = [
    { label: t('store.tabs.mcp'), value: PluginStoreTabs.MCP },
    { label: t('store.tabs.old'), value: PluginStoreTabs.Plugin },
    { label: t('store.tabs.installed'), value: PluginStoreTabs.Installed },
  ].filter(Boolean) as SegmentedOptions;

  return (
    <Flexbox
      gap={8}
      style={{ maxHeight: mobile ? '-webkit-fill-available' : 'inherit' }}
      width={'100%'}
    >
      <Flexbox gap={8} paddingInline={16}>
        <Flexbox gap={8} horizontal>
          <Segmented
            block
            onChange={(v) => {
              useToolStore.setState({ listType: v as PluginStoreTabs });
            }}
            options={options}
            style={{ flex: 1 }}
            value={listType}
            variant={'filled'}
          />
          {mobile ? null : <AddPluginButton />}
        </Flexbox>
        <Search />
      </Flexbox>
      {listType === PluginStoreTabs.MCP && <McpList />}
      {listType === PluginStoreTabs.Plugin && <PluginList />}
      {listType === PluginStoreTabs.Installed && <InstalledList keywords={keywords} />}
    </Flexbox>
  );
});

export default Content;
