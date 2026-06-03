'use client';

import { type BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { ActivateDeviceParams, ActivateDeviceState } from '../../../types';
import DeviceCard from '../DeviceCard';

const ActivateDevice = memo<BuiltinRenderProps<ActivateDeviceParams, ActivateDeviceState>>(
  ({ pluginState }) => {
    const device = pluginState?.activatedDevice;

    if (!device) return null;

    return <DeviceCard activated device={device} />;
  },
);

ActivateDevice.displayName = 'ActivateDevice';

export default ActivateDevice;
