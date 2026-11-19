import { Flexbox, Segmented, Tabs } from '@lobehub/ui';
import { createModal } from '@lobehub/ui/base-ui';
import { useState } from 'react';

import ConnectorCatalog from './ConnectorCatalog';
import SkillCatalog from './SkillCatalog';

const CatalogContent = () => {
  const [source, setSource] = useState('skills');
  const [tab, setTab] = useState('installed');

  return (
    <Flexbox>
      <Segmented options={['skills', 'connectors']} value={source} onChange={setSource} />
      <Tabs
        activeKey={tab}
        items={[
          { key: 'installed', label: 'Installed' },
          { key: 'discover', label: 'Discover' },
        ]}
        onChange={setTab}
      />
      {source === 'skills' ? <SkillCatalog tab={tab} /> : <ConnectorCatalog tab={tab} />}
    </Flexbox>
  );
};

export const openCatalog = () => createModal({ content: <CatalogContent /> });
