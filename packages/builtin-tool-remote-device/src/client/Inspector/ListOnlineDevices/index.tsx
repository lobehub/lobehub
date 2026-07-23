'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { MonitorIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListOnlineDevicesState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  count: css`
    display: inline-flex;
    align-items: center;

    height: 20px;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
    color: ${cssVar.colorTextDescription};
  `,
  icon: css`
    flex: none;
  `,
  root: css`
    gap: 8px;
  `,
}));

export const ListOnlineDevicesInspector = memo<
  BuiltinInspectorProps<undefined, ListOnlineDevicesState>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const isPending = isArgumentsStreaming || isLoading;
  const deviceCount = pluginState?.devices?.length;

  return (
    <div
      className={cx(inspectorTextStyles.root, styles.root, isPending && shinyTextStyles.shinyText)}
    >
      <Icon className={styles.icon} icon={MonitorIcon} size={14} />
      <span>{t('builtins.lobe-remote-device.apiName.listOnlineDevices')}</span>
      {!isPending && deviceCount !== undefined && (
        <span className={styles.count}>
          {t('builtins.lobe-remote-device.inspector.onlineCount', { count: deviceCount })}
        </span>
      )}
    </div>
  );
});

ListOnlineDevicesInspector.displayName = 'ListOnlineDevicesInspector';
