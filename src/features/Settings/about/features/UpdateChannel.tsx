'use client';

import { Flexbox, Select, Text } from '@lobehub/ui';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { autoUpdateService } from '@/services/electron/autoUpdate';

type UpdateChannelValue = 'canary' | 'stable';

/**
 * Which releases the desktop app updates to. It sits under the version row in
 * About so the version, the update action and where updates come from read as
 * one place. Desktop only — the web app has no updater.
 */
const UpdateChannel = memo<{ mobile?: boolean }>(({ mobile }) => {
  const { t } = useTranslation('setting');
  const [channel, setChannel] = useState<UpdateChannelValue>('stable');

  useEffect(() => {
    autoUpdateService
      .getUpdateChannel()
      .then(setChannel)
      .catch(() => {});
  }, []);

  const handleChange = useCallback((value: UpdateChannelValue) => {
    setChannel(value);
    autoUpdateService.setUpdateChannel(value);
  }, []);

  return (
    <Flexbox
      align={mobile ? 'stretch' : 'center'}
      gap={mobile ? 8 : 16}
      horizontal={!mobile}
      justify={'space-between'}
      width={'100%'}
    >
      <Flexbox gap={4}>
        <SettingsSearchAnchor id={'about-update-channel'}>
          <Text weight={500}>{t('tab.advanced.updateChannel.title')}</Text>
        </SettingsSearchAnchor>
        <Text fontSize={12} type={'secondary'}>
          {t('tab.advanced.updateChannel.desc')}
        </Text>
      </Flexbox>
      <Select
        style={{ flex: 'none', width: mobile ? '100%' : 200 }}
        value={channel}
        options={[
          { label: t('tab.advanced.updateChannel.stable'), value: 'stable' },
          { label: t('tab.advanced.updateChannel.canary'), value: 'canary' },
        ]}
        onChange={handleChange}
      />
    </Flexbox>
  );
});

UpdateChannel.displayName = 'UpdateChannel';

export default UpdateChannel;
