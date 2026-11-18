import { Flexbox, Segmented } from '@lobehub/ui';
import { useState } from 'react';

import DirectoryTree from './DirectoryTree';
import HealthOverview from './HealthOverview';

// The caller is outside this file; different panels do not establish a routed host.
export const DeviceDetail = ({ deviceId }: { deviceId: string }) => {
  const [view, setView] = useState<'overview' | 'files'>('overview');

  return (
    <Flexbox>
      <Segmented options={['overview', 'files']} value={view} onChange={setView} />
      {view === 'overview' ? (
        <HealthOverview deviceId={deviceId} />
      ) : (
        <DirectoryTree deviceId={deviceId} />
      )}
    </Flexbox>
  );
};
