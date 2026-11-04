'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { DeviceConnectModal, DeviceDetailPage, DeviceManager } from '@/features/DeviceManager';
import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

import ThisComputer from './ThisComputer';

interface PageProps {
  mobile?: boolean;
}

const Page = memo<PageProps>(({ mobile }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();
  // `/settings/devices/:sub` — the second level is one device's detail page.
  const { sub: deviceId } = useParams<{ sub?: string }>();
  const navigate = useNavigate();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const openDevice = (id: string) => navigate(`/settings/devices/${encodeURIComponent(id)}`);
  const backToList = () => navigate('/settings/devices');

  // Same toolbar + card grid as the workspace devices page; the personal
  // pool has no visibility tabs, so its leading slot carries the page title.
  const list = (
    <Flexbox gap={24}>
      <DeviceManager
        scope={'personal'}
        toolbarLeading={
          <Text fontSize={16} weight={600}>
            {t('devices.title')}
          </Text>
        }
        onConnect={handleConnect}
        onOpenDevice={openDevice}
      />
      {isDesktop && <ThisComputer />}
    </Flexbox>
  );

  const connectModal = (
    <DeviceConnectModal
      initialTab={initialTab}
      open={open}
      scope={'personal'}
      onClose={() => setOpen(false)}
    />
  );

  const content = deviceId ? (
    <DeviceDetailPage deviceId={deviceId} scope={'personal'} onBack={backToList} />
  ) : (
    list
  );

  if (mobile)
    return (
      <>
        {content}
        {connectModal}
      </>
    );

  return (
    <>
      <NavHeader styles={{ center: { alignItems: 'center' } }}>
        <Text weight={500}>{t('devices.title')}</Text>
      </NavHeader>
      {/* Full width: the card grid adds columns as the pane widens. */}
      <SettingContainer maxWidth={'100%'} paddingBlock={'24px 128px'} paddingInline={24}>
        {content}
      </SettingContainer>
      {connectModal}
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
