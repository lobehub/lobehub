'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangleIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ActivateDeviceParams, ActivateDeviceState } from '../../../types';
import DeviceCard from '../DeviceCard';

const styles = stylex.create({
  failure: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    paddingBlock: '12px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorWarningBorder,
    borderRadius: cssVar.borderRadius,
    fontSize: cssVar.fontSize,
    color: cssVar.colorWarningText,
    background: cssVar.colorWarningBg,
  },
});

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
        <div {...stylex.props(styles.failure)}>
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
