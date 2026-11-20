// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findRunDeviceRoute, isRunnerGoneCancelResult } from './runnerLiveness';

describe('isRunnerGoneCancelResult', () => {
  it.each(['DEVICE_OFFLINE', 'DEVICE_NOT_FOUND', 'DEVICE_CHANNEL_UNAVAILABLE'])(
    'reads the gateway code %s as a gone runner',
    (code) => {
      expect(isRunnerGoneCancelResult({ errorData: { code }, success: false })).toBe(true);
      // The code can also arrive annotated in `error` only.
      expect(isRunnerGoneCancelResult({ error: `${code} (HTTP 503)`, success: false })).toBe(true);
    },
  );

  it('reads a runner that holds no such task as gone', () => {
    // `lh connect` and desktops without the orphan lookup answer this way.
    expect(
      isRunnerGoneCancelResult({
        state: { message: 'No task found with taskId: op_1', success: false },
        success: false,
      }),
    ).toBe(true);
    expect(isRunnerGoneCancelResult({ state: { reason: 'not_found' }, success: true })).toBe(true);
  });

  it('does not read a live runner that failed to stop as gone', () => {
    expect(
      isRunnerGoneCancelResult({
        state: { exited: false, reason: 'orphan_alive' },
        success: false,
      }),
    ).toBe(false);
    expect(
      isRunnerGoneCancelResult({
        state: { exited: false, reason: 'lookup_failed' },
        success: false,
      }),
    ).toBe(false);
    expect(isRunnerGoneCancelResult({ error: 'TIMEOUT', success: false })).toBe(false);
    expect(isRunnerGoneCancelResult({ state: { exited: true, reason: 'not_found' } })).toBe(false);
  });
});

describe('findRunDeviceRoute', () => {
  const marker = {
    childOperations: [{ deviceId: 'dev_child', operationId: 'op_child' }],
    deviceId: 'dev_root',
    deviceWorkspaceId: 'ws_1',
    operationId: 'op_root',
  };

  it('reads the route of the root run or one of its children', () => {
    expect(findRunDeviceRoute(marker, 'op_root')).toEqual({
      deviceId: 'dev_root',
      deviceUserId: undefined,
      deviceWorkspaceId: 'ws_1',
    });
    expect(findRunDeviceRoute(marker, 'op_child')?.deviceId).toBe('dev_child');
  });

  it('has no route for another run or a run without a device', () => {
    expect(findRunDeviceRoute(marker, 'op_other')).toBeUndefined();
    expect(findRunDeviceRoute({ operationId: 'op_root' }, 'op_root')).toBeUndefined();
    expect(findRunDeviceRoute(undefined, 'op_root')).toBeUndefined();
  });
});
