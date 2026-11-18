import { Flexbox, Tabs } from '@lobehub/ui';
import { useState } from 'react';

import ConnectorCatalog from './ConnectorCatalog';
import SkillCatalog from './SkillCatalog';

// Routed page entry for /settings/catalog; the route table imports it from another file.
export const Catalog = () => {
  const [tab, setTab] = useState('skills');

  return (
    <Flexbox>
      {/* alint-expect */}
      <Tabs
        activeKey={tab}
        items={[
          { key: 'skills', label: 'Skills' },
          { key: 'connectors', label: 'Connectors' },
        ]}
        onChange={setTab}
      />
      {tab === 'skills' ? <SkillCatalog /> : <ConnectorCatalog />}
    </Flexbox>
  );
};
