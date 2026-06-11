'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LaptopIcon, LinkIcon, MonitorUpIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ConnectDeviceModal from './features/ConnectDeviceModal';
import DeviceList from './features/DeviceList';

const styles = createStaticStyles(({ css }) => ({
  syncCallout: css`
    padding: 12px 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG}px;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const Page = memo(() => {
  const { t } = useTranslation('setting');
  const utils = lambdaQuery.useUtils();
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [browserModalOpen, setBrowserModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const pairCode = searchParams.get('pair');

  useEffect(() => {
    if (pairCode) {
      setBrowserModalOpen(true);
    }
  }, [pairCode]);

  const handlePaired = async (code: string) => {
    try {
      const res = await fetch('/api/devices/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        setBrowserModalOpen(false);
        utils.device.listDevices.invalidate();
        if (pairCode) {
          setSearchParams((prev) => {
            prev.delete('pair');
            return prev;
          });
        }
      }
    } catch {
      // silently ignore pairing errors — UI feedback handled by modal
    }
  };

  return (
    <>
      <SettingHeader
        extra={
          <Button
            icon={<MonitorUpIcon size={16} />}
            onClick={() => setConnectModalOpen(true)}
            size={'small'}
          >
            {t('devices.connectWizard.button')}
          </Button>
        }
        title={t('devices.title')}
      />

      <Flexbox className={styles.syncCallout} horizontal align={'center'} gap={12}>
        <LaptopIcon size={20} style={{ color: cssVar.colorTextSecondary, flexShrink: 0 }} />
        <Text style={{ flex: 1, fontSize: 13 }}>
          {t('devices.connectWizard.sync.title')}
        </Text>
        <Button
          icon={<LinkIcon size={14} />}
          size={'small'}
          onClick={() => setBrowserModalOpen(true)}
        >
          {t('devices.connectWizard.sync.button')}
        </Button>
      </Flexbox>

      <DeviceList />

      <ConnectDeviceModal
        onClose={() => setConnectModalOpen(false)}
        open={connectModalOpen}
      />

      <ConnectDeviceModal
        initialCode={pairCode ?? undefined}
        initialTab={'browser'}
        onClose={() => {
          setBrowserModalOpen(false);
          if (pairCode) {
            setSearchParams((prev) => {
              prev.delete('pair');
              return prev;
            });
          }
        }}
        onPaired={handlePaired}
        open={browserModalOpen}
      />
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
