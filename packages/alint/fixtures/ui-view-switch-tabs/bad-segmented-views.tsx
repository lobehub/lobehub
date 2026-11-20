// Fixture: a routed page uses Segmented to switch whole panels in local state.
import { Flexbox, Segmented } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes } from 'react-router-dom';

import DirectoryTree from './DirectoryTree';
import HealthOverview from './HealthOverview';

const DeviceDetail = memo<{ deviceId: string }>(({ deviceId }) => {
  const { t } = useTranslation('setting');
  const [view, setView] = useState<'overview' | 'files'>('overview');

  return (
    <Flexbox gap={16}>
      {/* alint-expect */}
      <Segmented
        value={view}
        options={[
          { label: t('device.overview'), value: 'overview' },
          { label: t('device.files'), value: 'files' },
        ]}
        onChange={(value) => setView(value as 'overview' | 'files')}
      />
      {view === 'overview' ? (
        <HealthOverview deviceId={deviceId} />
      ) : (
        <DirectoryTree deviceId={deviceId} />
      )}
    </Flexbox>
  );
});

export const DeviceRoutes = () => (
  <Routes>
    <Route element={<DeviceDetail deviceId={'current'} />} path={'/devices/current'} />
  </Routes>
);
