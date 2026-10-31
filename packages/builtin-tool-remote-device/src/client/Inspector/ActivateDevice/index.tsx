'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { cx } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivateDeviceParams, ActivateDeviceState } from '../../../types';

const styles = stylex.create({
  device: {
    overflow: 'hidden',
    maxWidth: '240px',
    paddingBlock: '2px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadiusSM,
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    background: cssVar.colorFillTertiary,
  },
});

export const ActivateDeviceInspector = memo<
  BuiltinInspectorProps<ActivateDeviceParams, ActivateDeviceState>
>(({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
  const { t } = useTranslation('plugin');
  const device = pluginState?.activatedDevice;
  const requestedDeviceId = args?.deviceId || partialArgs?.deviceId;
  const deviceLabel =
    device?.friendlyName ||
    device?.hostname ||
    (requestedDeviceId ? requestedDeviceId.slice(0, 12) : '');

  return (
    <div className={inspectorTextStyles.root}>
      <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
        {t('builtins.lobe-remote-device.apiName.activateDevice')}
      </span>
      {deviceLabel && <span {...stylex.props(styles.device)}>{deviceLabel}</span>}
    </div>
  );
});

ActivateDeviceInspector.displayName = 'ActivateDeviceInspector';
