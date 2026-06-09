'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import type { ListOnlineDevicesState } from '../../../types';
import DeviceCard from '../DeviceCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;

    font-size: 13px;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorBgContainer};
  `,
}));

const ListDevices = memo<BuiltinRenderProps<undefined, ListOnlineDevicesState>>(
  ({ pluginState }) => {
    const devices = pluginState?.devices ?? [];

    if (devices.length === 0) {
      return <div className={styles.empty}>No online devices found.</div>;
    }

    return (
      <Flexbox gap={8} width={'100%'}>
        {devices.map((device) => (
          <DeviceCard device={device} key={device.deviceId} />
        ))}
      </Flexbox>
    );
  },
);

ListDevices.displayName = 'ListDevices';

export default ListDevices;
