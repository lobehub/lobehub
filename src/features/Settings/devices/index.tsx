'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { MonitorUpIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';
import { DeviceConnectModal, DeviceManager, useDeviceList } from '@/features/DeviceManager';

/**
 * Personal devices, laid out the way the workspace page is: a header row with
 * the section's name and its actions, and the list card below it.
 *
 * Not a settings group. A group is a card, so the list card inside it drew two
 * nested frames around one list and inset every row by the group's own padding
 * — each row's hover and selection background stopped short of the panel
 * instead of filling it, which the workspace layout has never done.
 */
const Page = memo(() => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<'cli' | 'desktop'>();
  // Shares DeviceManager's SWR entry, so the header actions drive the list it
  // renders — the same wiring the workspace devices page uses.
  const { data, isValidating, mutate } = useDeviceList();

  const handleConnect = (tab?: 'cli' | 'desktop') => {
    setInitialTab(tab);
    setOpen(true);
  };

  const devices = (data ?? []).filter((device) => device.scope === 'personal');

  return (
    <>
      <Flexbox gap={16} style={{ maxWidth: MAX_WIDTH, width: '100%' }}>
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          <Text fontSize={16} weight={600}>
            {t('devices.title')}
          </Text>
          <Flexbox horizontal align={'center'} gap={8}>
            {devices.length > 0 && (
              <Text fontSize={12} type={'secondary'} weight={500}>
                {t('devices.selection.total', { count: devices.length })}
              </Text>
            )}
            <Button
              icon={<Icon icon={RefreshCwIcon} />}
              loading={isValidating}
              title={t('devices.actions.refresh')}
              onClick={() => mutate()}
            />
            <Button
              icon={<Icon icon={MonitorUpIcon} />}
              type={'primary'}
              onClick={() => handleConnect()}
            >
              {t('devices.connectWizard.button')}
            </Button>
          </Flexbox>
        </Flexbox>

        <DeviceManager scope={'personal'} onConnect={handleConnect} />
      </Flexbox>

      <DeviceConnectModal
        initialTab={initialTab}
        open={open}
        scope={'personal'}
        onClose={() => setOpen(false)}
      />
    </>
  );
});

Page.displayName = 'DevicesSettings';

export default Page;
