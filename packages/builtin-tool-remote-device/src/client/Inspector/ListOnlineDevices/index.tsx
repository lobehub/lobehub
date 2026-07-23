'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ListOnlineDevicesState } from '../../../types';

export const ListOnlineDevicesInspector = memo<
  BuiltinInspectorProps<undefined, ListOnlineDevicesState>
>(({ isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const isPending = isArgumentsStreaming || isLoading;
  const deviceCount = pluginState?.devices?.length;

  return (
    <div className={cx(inspectorTextStyles.root, isPending && shinyTextStyles.shinyText)}>
      <span>{t('builtins.lobe-remote-device.apiName.listOnlineDevices')}</span>
      {!isPending && deviceCount !== undefined && (
        <Text as={'span'} color={cssVar.colorTextDescription} fontSize={12}>
          {t('builtins.lobe-remote-device.inspector.onlineCount', { count: deviceCount })}
        </Text>
      )}
    </div>
  );
});

ListOnlineDevicesInspector.displayName = 'ListOnlineDevicesInspector';
