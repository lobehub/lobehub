'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListOnlineDevicesState } from '../../../types';
import DeviceCard from '../DeviceCard';

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    background: cssVar.colorBgContainer,
  },
  empty: {
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontSize: cssVar.fontSize,
    color: cssVar.colorTextDescription,
    background: cssVar.colorBgContainer,
  },
});

const ListDevices = memo<BuiltinRenderProps<undefined, ListOnlineDevicesState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');
    const devices = pluginState?.devices ?? [];

    if (devices.length === 0) {
      return (
        <div {...stylex.props(styles.empty)}>
          {t('builtins.lobe-remote-device.render.noOnlineDevices')}
        </div>
      );
    }

    return (
      <Flexbox className={stylex.props(styles.card).className} role={'list'}>
        {devices.map((device) => (
          <DeviceCard device={device} key={device.deviceId} variant={'listItem'} />
        ))}
      </Flexbox>
    );
  },
);

ListDevices.displayName = 'ListDevices';

export default ListDevices;
