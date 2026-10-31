import { describe, expect, it } from 'vitest';

import { getChannelSaveErrorKey } from './saveError';

describe('channel member save feedback', () => {
  it.each([
    ['Choose an online device and working directory', 'environment.executionRequired'],
    ['Choose a working directory for this device', 'environment.directoryRequired'],
    ['Choose an accessible device shared with this workspace', 'environment.deviceUnavailable'],
    ['Could not reach the device to verify the working directory', 'environment.deviceUnreachable'],
    ['The working directory does not exist or is not a directory', 'environment.directoryInvalid'],
    [
      'The device connector must be upgraded to verify the working directory',
      'environment.connectorUpgradeRequired',
    ],
    [
      'The device must be online and support directory verification',
      'environment.directoryUnavailable',
    ],
    ['Unsupported Channel runtime', 'environment.unsupportedRuntime'],
    ['Agent not found', 'environment.agentUnavailable'],
  ])('translates the actionable domain error %s', (message, key) => {
    expect(getChannelSaveErrorKey(new Error(message))).toBe(key);
  });

  it('never renders raw database or unknown server messages', () => {
    expect(getChannelSaveErrorKey(new Error('SQL failed with private values'))).toBe(
      'environment.saveFailed',
    );
    expect(getChannelSaveErrorKey(undefined)).toBe('environment.saveFailed');
  });

  it.each([
    [401, 'environment.signInRequired'],
    [403, 'environment.permissionRequired'],
  ])('offers the correct recovery for HTTP %s', (httpStatus, key) => {
    expect(getChannelSaveErrorKey({ data: { httpStatus }, message: 'private details' })).toBe(key);
  });
});
