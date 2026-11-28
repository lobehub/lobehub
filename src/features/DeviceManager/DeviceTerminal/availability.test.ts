import type { DeviceListItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { classifyTerminalOpenError, getTerminalAvailability } from './availability';

const device = (overrides: Partial<DeviceListItem> = {}) =>
  ({
    channels: [{ channel: 'cli' }],
    deviceId: 'dev-1',
    lastSeen: '',
    online: true,
    ...overrides,
  }) as DeviceListItem;

describe('getTerminalAvailability', () => {
  it('opens on an online device whose client hosts a terminal', () => {
    expect(getTerminalAvailability(device(), 'ready')).toBe('ready');
  });

  it('says an offline device is offline instead of trying', () => {
    expect(getTerminalAvailability(device({ channels: [], online: false }), 'ready')).toBe(
      'offline',
    );
  });

  it('tells a desktop without terminal support apart from an offline device', () => {
    // An older desktop connects but does not advertise the terminal capability.
    expect(getTerminalAvailability(device({ channels: [{ channel: 'desktop' }] }), 'ready')).toBe(
      'unsupported',
    );
    expect(
      getTerminalAvailability(
        device({ channels: [{ channel: 'desktop' }], metadata: { terminal: '1' } }),
        'ready',
      ),
    ).toBe('ready');
  });

  it('waits for a sleeping managed device to wake before opening', () => {
    const asleep = device({ channels: [], online: false });
    expect(getTerminalAvailability(asleep, 'waking')).toBe('waking');
    expect(getTerminalAvailability(asleep, 'starting')).toBe('wakeSlow');
    expect(getTerminalAvailability(asleep, 'failed')).toBe('wakeFailed');
  });

  it('keeps checking while presence is unconfirmed', () => {
    expect(getTerminalAvailability(device(), 'checking')).toBe('checking');
    expect(getTerminalAvailability(device({ onlineUnknown: true }), 'ready')).toBe('checking');
  });
});

describe('classifyTerminalOpenError', () => {
  it('recognises a client that cannot host a terminal', () => {
    expect(
      classifyTerminalOpenError(new Error('This device client does not support a terminal')),
    ).toBe('unsupported');
    expect(
      classifyTerminalOpenError(new Error('Unknown device RPC method: createTerminalSession')),
    ).toBe('unsupported');
  });

  it('recognises a device that dropped offline', () => {
    expect(classifyTerminalOpenError(new Error('DEVICE_OFFLINE'))).toBe('offline');
  });

  it('treats anything else as a plain failure', () => {
    expect(classifyTerminalOpenError(new Error('boom'))).toBe('failed');
    expect(classifyTerminalOpenError(undefined)).toBe('failed');
  });
});
