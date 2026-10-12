'use client';

import { isDesktop } from '@lobechat/const';
import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { Form, useForm } from '@lobehub/ui/base-ui/form';
import { createStaticStyles } from 'antd-style';
import { MonitorUpIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  DeviceConnectModal,
  DeviceDetailPage,
  DeviceManager,
  useDeviceList,
} from '@/features/DeviceManager';
import NavHeader from '@/features/NavHeader';
import SettingContainer from '@/features/Setting/SettingContainer';

import ThisComputer from './ThisComputer';

const styles = createStaticStyles(({ css }) => ({
  // The onboarding state carries its own padding; a thin, even inset keeps its
  // fill the same distance from every edge of the card.
  emptyGroup: css`
    [data-form-group-body] {
      padding: 4px;
    }
  `,
  // Device cards carry their own frame; give the grid room to breathe inside
  // the settings card.
  gridGroup: css`
    [data-form-group-body] {
      padding: 16px;
    }
  `,
}));

interface PageProps {
  mobile?: boolean;
}

const Page = memo<PageProps>(({ mobile }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();
  const form = useForm();
  // `/settings/devices/:sub` — the second level is one device's detail page.
  const { sub: deviceId } = useParams<{ sub?: string }>();
  const navigate = useNavigate();
  // Shares DeviceManager's SWR entry, so the header actions drive the list it
  // renders — the same wiring the workspace devices page uses.
  const { data, isValidating, mutate } = useDeviceList();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  const devices = (data ?? []).filter((device) => device.scope === 'personal');

  // Personal-only route: plain `navigate` keeps it out of any active workspace.
  const openDevice = (id: string) => navigate(`/settings/devices/${encodeURIComponent(id)}`);
  const backToList = () => navigate('/settings/devices');

  const list = (
    <Flexbox gap={24}>
      <Form
        classNames={{ group: devices.length > 0 ? styles.gridGroup : styles.emptyGroup }}
        collapsible={false}
        form={form}
        itemsType={'group'}
        variant={'filled'}
        items={[
          {
            children: (
              <DeviceManager
                scope={'personal'}
                onConnect={handleConnect}
                onOpenDevice={openDevice}
              />
            ),
            extra: (
              <Flexbox horizontal align={'center'} gap={8}>
                {devices.length > 0 && (
                  <Text fontSize={12} type={'secondary'} weight={500}>
                    {t('devices.selection.total', { count: devices.length })}
                  </Text>
                )}
                <Button
                  icon={<Icon icon={MonitorUpIcon} />}
                  size={'small'}
                  onClick={() => handleConnect()}
                >
                  {t('devices.connectWizard.button')}
                </Button>
                <ActionIcon
                  icon={RefreshCwIcon}
                  loading={isValidating}
                  size={'small'}
                  title={t('devices.actions.refresh')}
                  onClick={() => mutate()}
                />
              </Flexbox>
            ),
            title: t('devices.title'),
          },
        ]}
        {...FORM_STYLE}
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
