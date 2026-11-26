'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MonitorIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListOnlineDevicesState } from '../../../types';

const styles = stylex.create({
  count: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '20px',
    fontSize: cssVar.fontSizeSM,
    lineHeight: '20px',
    color: cssVar.colorTextDescription,
  },
  icon: { flex: 'none' },
  root: { gap: '8px' },
});

export const ListOnlineDevicesInspector = memo<
  BuiltinInspectorProps<undefined, ListOnlineDevicesState>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const isPending = isArgumentsStreaming || isLoading;
  const deviceCount = pluginState?.devices?.length;

  return (
    <div className={cx(stylex.props(styles.root).className, inspectorTextStyles.root)}>
      <Icon className={stylex.props(styles.icon).className} icon={MonitorIcon} size={14} />
      <span className={cx(isPending && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-remote-device.apiName.listOnlineDevices')}
      </span>
      {!isPending && deviceCount !== undefined && (
        <span {...stylex.props(styles.count)}>
          {t('builtins.lobe-remote-device.inspector.onlineCount', { count: deviceCount })}
        </span>
      )}
    </div>
  );
});

ListOnlineDevicesInspector.displayName = 'ListOnlineDevicesInspector';
