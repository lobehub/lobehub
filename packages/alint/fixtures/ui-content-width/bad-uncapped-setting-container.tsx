// Fixture: `maxWidth={'100%'}` removes SettingContainer's cap, so the detail page stretches.
// Reduced from Settings/devices.
import { Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { DeviceDetailPage, DeviceManager } from '@/features/DeviceManager';
import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

const DevicesSettingsPage = memo(() => {
  const { t } = useTranslation('setting');
  const { sub: deviceId } = useParams<{ sub?: string }>();
  const navigate = useNavigate();

  return (
    <>
      <NavHeader>
        <Text weight={500}>{t('devices.title')}</Text>
      </NavHeader>
      {/* alint-expect */}
      <SettingContainer maxWidth={'100%'} paddingBlock={'24px 128px'} paddingInline={24}>
        {deviceId ? (
          <DeviceDetailPage deviceId={deviceId} onBack={() => navigate('/settings/devices')} />
        ) : (
          <DeviceManager onOpenDevice={(id) => navigate(`/settings/devices/${id}`)} />
        )}
      </SettingContainer>
    </>
  );
});

export default DevicesSettingsPage;
