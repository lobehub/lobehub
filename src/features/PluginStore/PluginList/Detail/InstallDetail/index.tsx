import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';

import { PluginNavKey } from '@/types/discover';

import Nav from './Nav';
import Settings from './Settings';
import Tools from './Tools';

const InstallDetail = memo(() => {
  const [activeTab, setActiveTab] = useState(PluginNavKey.Tools);

  return (
    <Flexbox gap={16}>
      <Nav activeTab={activeTab as PluginNavKey} setActiveTab={setActiveTab} />
      <Flexbox>
        {activeTab === PluginNavKey.Tools && <Tools />}
        {activeTab === PluginNavKey.Settings && <Settings />}
      </Flexbox>
    </Flexbox>
  );
});

export default InstallDetail;
