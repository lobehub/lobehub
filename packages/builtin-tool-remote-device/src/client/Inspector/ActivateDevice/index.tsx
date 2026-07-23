'use client';

import type { BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { inspectorTextStyles, shinyTextStyles } from '@/styles';

import type { ActivateDeviceParams, ActivateDeviceState } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  device: css`
    overflow: hidden;

    max-width: 240px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};
  `,
}));

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
    <div
      className={cx(
        inspectorTextStyles.root,
        (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
      )}
    >
      <span>{t('builtins.lobe-remote-device.apiName.activateDevice')}</span>
      {deviceLabel && <span className={styles.device}>{deviceLabel}</span>}
    </div>
  );
});

ActivateDeviceInspector.displayName = 'ActivateDeviceInspector';
