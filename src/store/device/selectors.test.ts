import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { DeviceState } from './initialState';
import { canHostTerminal, deviceSelectors } from './selectors';

const device = (overrides: Partial<DeviceListItem>): DeviceListItem =>
  ({ channels: [], deviceId: 'dev-1', lastSeen: '', online: true, ...overrides }) as DeviceListItem;

const channel = (name: string | null) => ({
  channel: name,
  connectedAt: '',
  hostname: null,
  platform: null,
});

const state = (devices: DeviceListItem[]) => ({ devices }) as DeviceState;

describe('canHostTerminal', () => {
  it('accepts a live CLI connection, including its suffixed variants', () => {
    expect(canHostTerminal(device({ channels: [channel('cli')] }))).toBe(true);
    expect(canHostTerminal(device({ channels: [channel('cli-dev')] }))).toBe(true);
  });

  it('rejects an offline row even when it was last seen on a CLI channel', () => {
    expect(canHostTerminal(device({ channels: [channel('cli')], online: false }))).toBe(false);
  });

  it('rejects a device whose live connections are all desktop ones', () => {
    // The PTY lives in `lh connect`; terminal RPCs are sent with a `cli` hint,
    // so a desktop-only machine answers them with a refusal.
    expect(canHostTerminal(device({ channels: [channel('desktop')] }))).toBe(false);
    expect(canHostTerminal(device({ channels: [channel('desktop-dev')] }))).toBe(false);
  });

  it('rejects connections of an unknown kind', () => {
    expect(canHostTerminal(device({ channels: [channel('mobile'), channel(null)] }))).toBe(false);
  });

  it('treats a live row that reports no connections as unknown, not unusable', () => {
    // A gateway older than the connections field leaves this empty on live rows;
    // hiding the terminal from those deployments would be a regression.
    expect(canHostTerminal(device({ channels: [] }))).toBe(true);
  });
});

describe('deviceSelectors.hasTerminalTarget', () => {
  it('is true when any device can host a shell', () => {
    const devices = [
      device({ channels: [channel('desktop')] }),
      device({ channels: [channel('cli')] }),
    ];
    expect(deviceSelectors.hasTerminalTarget(state(devices))).toBe(true);
  });

  it('is false when every device is offline or desktop-only', () => {
    const devices = [
      device({ channels: [channel('cli')], online: false }),
      device({ channels: [channel('desktop')] }),
    ];
    expect(deviceSelectors.hasTerminalTarget(state(devices))).toBe(false);
    expect(deviceSelectors.hasTerminalTarget(state([]))).toBe(false);
  });
});
