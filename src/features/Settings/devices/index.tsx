'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { DeviceConnectModal, DeviceDetailPage, DeviceManager } from '@/features/DeviceManager';

import ThisComputer from './ThisComputer';

interface PageProps {
  mobile?: boolean;
}

const Page = memo<PageProps>(() => {
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

  // Same toolbar + card grid as the workspace devices page. The personal pool
  // has no visibility tabs, and the shared settings header already shows the
  // page title, so the toolbar's leading slot stays empty.
  const list = (
    <Flexbox gap={24}>
      <DeviceManager scope={'personal'} onConnect={handleConnect} onOpenDevice={openDevice} />
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

  // Desktop renders inside the shared settings header + container, mobile under
  // the mobile layout header.
  return (
    <>
      {content}
      {connectModal}
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
