import type {
  DeviceCliUpdateOperation,
  DeviceCliUpdateState,
  DeviceCliUpdateStateResult,
} from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deriveCliUpdateView } from './deriveCliUpdateView';

const operation: DeviceCliUpdateOperation = {
  fromInstanceId: 'old',
  id: 'request',
  kind: 'update',
  stage: 'restarting',
  targetVersion: '2.0',
};
const ok = (state: Partial<DeviceCliUpdateState> = {}): DeviceCliUpdateStateResult => ({
  status: 'ok',
  state: { activeTasks: 0, currentVersion: '1.0', instanceId: 'old', supported: true, ...state },
});

describe('CLI maintenance completion', () => {
  it('never treats an acknowledgement or reconnect of the same process as success', () => {
    expect(deriveCliUpdateView(ok({ operation }), operation)).toBe('pending');
    expect(deriveCliUpdateView(ok({ currentVersion: '2.0' }), operation)).toBe('pending');
  });
  it('requires both a new process and the exact target version', () => {
    expect(deriveCliUpdateView(ok({ instanceId: 'new' }), operation)).toBe('pending');
    expect(deriveCliUpdateView(ok({ instanceId: 'new', currentVersion: '2.0' }), operation)).toBe(
      'success',
    );
  });
  it('confirms standalone restart only with a changed process', () => {
    const restart = { ...operation, kind: 'restart' as const, targetVersion: '1.0' };
    expect(deriveCliUpdateView(ok(), restart)).toBe('pending');
    expect(deriveCliUpdateView(ok({ instanceId: 'new' }), restart)).toBe('success');
  });
  it('keeps offline maintenance pending until its bounded deadline', () => {
    const offline: DeviceCliUpdateStateResult = { status: 'unavailable', message: 'offline' };
    expect(deriveCliUpdateView(offline, operation)).toBe('pending');
    expect(deriveCliUpdateView(offline, operation, true)).toBe('timedOut');
    expect(deriveCliUpdateView(ok({ instanceId: 'new' }), operation, true)).toBe('timedOut');
  });
  it('shows failed operations instead of success even if identity matches', () => {
    expect(
      deriveCliUpdateView(
        ok({
          instanceId: 'new',
          currentVersion: '2.0',
          operation: { ...operation, stage: 'failed', error: 'install failed' },
        }),
        operation,
      ),
    ).toBe('failed');
  });
  it('supports observation of maintenance started elsewhere', () => {
    expect(deriveCliUpdateView(ok({ operation }))).toBe('pending');
  });
  it('distinguishes old clients, unsupported installs, and unavailable reads', () => {
    expect(deriveCliUpdateView({ status: 'unsupported', message: 'old' })).toBe('unsupported');
    expect(deriveCliUpdateView(ok({ supported: false, unsupportedReason: 'dev build' }))).toBe(
      'unsupported',
    );
    expect(deriveCliUpdateView({ status: 'unavailable', message: 'offline' })).toBe('unavailable');
  });
});
