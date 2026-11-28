// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deviceRouter } from '.';
import {
  AUDITED_DEVICE_OPERATIONS,
  deviceOperationRecordOf,
  isAuditedDeviceOperation,
} from './operationAudit';

describe('device operation audit', () => {
  it('names only procedures the device router has', () => {
    const procedures = Object.keys((deviceRouter as any)._def.procedures);
    for (const name of AUDITED_DEVICE_OPERATIONS) expect(procedures).toContain(name);
  });

  it('audits terminal input and file access, not output polling', () => {
    expect(isAuditedDeviceOperation('device.writeTerminal')).toBe(true);
    expect(isAuditedDeviceOperation('device.getLocalFilePreview')).toBe(true);
    expect(isAuditedDeviceOperation('device.readTerminal')).toBe(false);
    expect(isAuditedDeviceOperation('device.listDevices')).toBe(false);
  });

  it('records who ran what on which device', () => {
    const input = { data: 'ZW52Cg==', deviceId: 'dev-1', sessionId: 's1' };
    expect(
      deviceOperationRecordOf({
        input,
        operation: 'device.writeTerminal',
        userId: 'u1',
        workspaceId: 'ws1',
      }),
    ).toEqual({
      deviceId: 'dev-1',
      input,
      operation: 'device.writeTerminal',
      userId: 'u1',
      workspaceId: 'ws1',
    });
  });

  it('skips a call whose input names no device', () => {
    expect(
      deviceOperationRecordOf({ input: undefined, operation: 'device.statPath', userId: 'u1' }),
    ).toBeUndefined();
    expect(
      deviceOperationRecordOf({ input: { path: '/' }, operation: 'device.statPath', userId: 'u1' }),
    ).toBeUndefined();
  });
});
