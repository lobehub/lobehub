import type { DeviceAppUpdateState, DeviceAppUpdateStateResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deriveAppUpdateView, getAppUpdateAction, isAppUpdatePolling } from './deriveAppUpdateView';

const ok = (state: Partial<DeviceAppUpdateState>): DeviceAppUpdateStateResult => ({
  state: { currentVersion: '2.1.0', stage: 'idle', ...state },
  status: 'ok',
});

const install = { targetVersion: '2.2.0', timedOut: false };

describe('deriveAppUpdateView', () => {
  it('shows download progress toward the target version', () => {
    expect(
      deriveAppUpdateView(
        ok({ progress: 40, stage: 'downloading', targetVersion: '2.2.0' }),
        null,
        false,
      ),
    ).toEqual({ kind: 'downloading', progress: 40, targetVersion: '2.2.0' });
  });

  it('offers the install once the update is downloaded', () => {
    expect(
      deriveAppUpdateView(ok({ stage: 'downloaded', targetVersion: '2.2.0' }), null, false),
    ).toEqual({ kind: 'ready', targetVersion: '2.2.0' });
  });

  it('keeps the check outcome so the user sees the answer', () => {
    expect(deriveAppUpdateView(ok({ stage: 'latest' }), null, false)).toEqual({
      kind: 'idle',
      outcome: 'latest',
    });
    expect(
      deriveAppUpdateView(ok({ errorMessage: 'net down', stage: 'error' }), null, false),
    ).toEqual({ kind: 'idle', outcome: { error: 'net down' } });
  });

  it('tells a dev build apart from an outdated client', () => {
    expect(deriveAppUpdateView(ok({ stage: 'unsupported' }), null, false)).toEqual({
      kind: 'unsupported',
      reason: 'devBuild',
    });
    const rejected: DeviceAppUpdateStateResult = { message: 'x', status: 'unsupported' };
    expect(deriveAppUpdateView(rejected, null, false)).toEqual({
      kind: 'unsupported',
      reason: 'outdated',
    });
  });

  it('blames lh connect when the CLI answered for a device that runs both', () => {
    expect(deriveAppUpdateView({ message: 'x', status: 'unsupported' }, null, true)).toEqual({
      kind: 'unsupported',
      reason: 'cli',
    });
  });

  describe('while restarting into an update', () => {
    it('waits while the old process is still answering before it quits', () => {
      expect(
        deriveAppUpdateView(ok({ stage: 'downloaded', targetVersion: '2.2.0' }), install, false),
      ).toEqual({ kind: 'restarting', targetVersion: '2.2.0' });
    });

    it('waits while the device is offline', () => {
      expect(
        deriveAppUpdateView({ message: 'offline', status: 'unavailable' }, install, false),
      ).toEqual({ kind: 'restarting', targetVersion: '2.2.0' });
    });

    it('succeeds only when the device comes back on the target version', () => {
      expect(deriveAppUpdateView(ok({ currentVersion: '2.2.0' }), install, false)).toEqual({
        kind: 'updated',
        version: '2.2.0',
      });
    });

    it('fails when the device comes back on another version', () => {
      expect(deriveAppUpdateView(ok({ currentVersion: '2.1.0' }), install, false)).toEqual({
        currentVersion: '2.1.0',
        kind: 'installFailed',
      });
    });

    it('gives up after the wait window', () => {
      expect(
        deriveAppUpdateView(
          { message: 'offline', status: 'unavailable' },
          { ...install, timedOut: true },
          false,
        ),
      ).toEqual({ kind: 'timedOut', targetVersion: '2.2.0' });
    });
  });
});

describe('isAppUpdatePolling', () => {
  it('polls only while the device owns the next state', () => {
    expect(isAppUpdatePolling({ kind: 'checking' })).toBe(true);
    expect(isAppUpdatePolling({ kind: 'downloading' })).toBe(true);
    expect(isAppUpdatePolling({ kind: 'restarting', targetVersion: '2.2.0' })).toBe(true);
    expect(isAppUpdatePolling({ kind: 'ready', targetVersion: '2.2.0' })).toBe(false);
    expect(isAppUpdatePolling({ kind: 'idle', outcome: 'latest' })).toBe(false);
  });
});

describe('getAppUpdateAction', () => {
  it('offers a retry when the device state could not be read', () => {
    expect(getAppUpdateAction({ kind: 'unavailable' })).toBe('retry');
  });

  it('offers a fresh check after an idle, failed or timed-out update', () => {
    expect(getAppUpdateAction({ kind: 'idle' })).toBe('check');
    expect(getAppUpdateAction({ currentVersion: '2.1.0', kind: 'installFailed' })).toBe('check');
    expect(getAppUpdateAction({ kind: 'timedOut', targetVersion: '2.2.0' })).toBe('check');
  });

  it('offers nothing once the outcome is settled or unsupported', () => {
    expect(getAppUpdateAction({ kind: 'updated', version: '2.2.0' })).toBeUndefined();
    expect(getAppUpdateAction({ kind: 'unsupported', reason: 'cli' })).toBeUndefined();
    expect(getAppUpdateAction({ kind: 'loading' })).toBeUndefined();
  });
});
