import { LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { describe, expect, it } from 'vitest';

import { getExecutionDeviceLabel } from './executionDeviceLabel';

describe('getExecutionDeviceLabel', () => {
  it('names the device that ran a call which picked one', () => {
    expect(
      getExecutionDeviceLabel({
        args: { command: 'pwd', device: 'Device B' },
        identifier: LocalSystemIdentifier,
        pluginState: {
          executionDevice: { deviceId: 'dev-b', hostname: 'studio', name: 'Studio Mac' },
        },
      }),
    ).toEqual({ label: 'Studio Mac', title: 'dev-b' });
  });

  it('falls back to the hostname, then the id, of the device that ran it', () => {
    const label = (executionDevice: object) =>
      getExecutionDeviceLabel({
        args: { device: 'dev-b' },
        identifier: LocalSystemIdentifier,
        pluginState: { executionDevice },
      })?.label;

    expect(label({ deviceId: 'dev-b', hostname: 'studio' })).toBe('studio');
    expect(label({ deviceId: 'dev-b' })).toBe('dev-b');
  });

  it('names the requested device while the call has no result, or was refused', () => {
    expect(
      getExecutionDeviceLabel({
        args: { command: 'pwd', device: ' dev-c ' },
        identifier: LocalSystemIdentifier,
        pluginState: { exitCode: 1 },
      }),
    ).toEqual({ label: 'dev-c', title: 'dev-c' });
  });

  it.each([
    ['names no device', LocalSystemIdentifier, { command: 'pwd' }],
    ['names a blank device', LocalSystemIdentifier, { command: 'pwd', device: ' ' }],
    ['has no arguments yet', LocalSystemIdentifier, undefined],
    ['is another tool', 'lobe-cloud-sandbox', { command: 'pwd', device: 'Device B' }],
  ])('names nothing when the call %s', (_label, identifier, args) => {
    expect(
      getExecutionDeviceLabel({
        args,
        identifier,
        pluginState: { executionDevice: { deviceId: 'dev-a', name: 'Device A' } },
      }),
    ).toBeUndefined();
  });
});
