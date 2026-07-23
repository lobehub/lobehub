'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListOnlineDevicesState } from '../../../types';
import DeviceCard from '../DeviceCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
  empty: css`
    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorBgContainer};
  `,
}));

const ListDevices = memo<BuiltinRenderProps<undefined, ListOnlineDevicesState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('plugin');
    const devices = pluginState?.devices ?? [];

    if (devices.length === 0) {
      return (
        <div className={styles.empty}>
          {t('builtins.lobe-remote-device.render.noOnlineDevices')}
        </div>
      );
    }

    return (
      <Flexbox className={styles.card} role={'list'}>
        {devices.map((device) => (
          <DeviceCard device={device} key={device.deviceId} variant={'listItem'} />
        ))}
      </Flexbox>
    );
  },
);

ListDevices.displayName = 'ListDevices';

export default ListDevices;
