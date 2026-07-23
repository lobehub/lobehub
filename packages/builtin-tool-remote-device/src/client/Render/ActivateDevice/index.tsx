'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { AlertTriangleIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActivateDeviceParams, ActivateDeviceState } from '../../../types';
import DeviceCard from '../DeviceCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  failure: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
  `,
}));

const ActivateDevice = memo<BuiltinRenderProps<ActivateDeviceParams, ActivateDeviceState, string>>(
  ({ pluginState, content }) => {
    const { t } = useTranslation('plugin');
    const device = pluginState?.activatedDevice;

    if (device) return <DeviceCard activated device={device} />;

    // Activation failed without a thrown error (e.g. device offline / unknown), so no state is
    // produced. Fall back to the explanatory content the runtime returned instead of rendering
    // blank — the tool detail view only skips custom renders when `result.error` is set.
    if (typeof content === 'string' && content.length > 0) {
      return (
        <div className={styles.failure}>
          <Icon icon={AlertTriangleIcon} size={14} />
          <span>
            {t('builtins.lobe-remote-device.render.activationFailed')}: {content}
          </span>
        </div>
      );
    }

    return null;
  },
);

ActivateDevice.displayName = 'ActivateDevice';

export default ActivateDevice;
