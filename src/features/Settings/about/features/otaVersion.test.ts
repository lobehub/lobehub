import type { CoreUpdateStatus } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { formatOtaVersionLabel, getDisplayedOtaVersion } from './otaVersion';

const status = (patch: Partial<CoreUpdateStatus>): CoreUpdateStatus => ({
  applyMode: null,
  current: null,
  disabledReasons: [],
  enabled: true,
  lastCheckAt: null,
  lastError: null,
  needsFullRelease: false,
  running: null,
  staged: null,
  ...patch,
});

describe('getDisplayedOtaVersion', () => {
  it('shows a confirmed hot update without requiring a main-process restart', () => {
    expect(
      getDisplayedOtaVersion(
        status({ appliedVersion: '1.0.2', current: '1.0.2', running: '1.0.1' }),
      ),
    ).toBe('1.0.2');
  });

  it('keeps the applied version while a newer update awaits relaunch', () => {
    expect(
      getDisplayedOtaVersion(
        status({
          appliedVersion: '1.0.2',
          applyMode: 'relaunch',
          current: '1.0.3',
          running: '1.0.1',
          staged: '1.0.3',
        }),
      ),
    ).toBe('1.0.2');
  });

  it('does not show an unconfirmed hot update as applied', () => {
    expect(getDisplayedOtaVersion(status({ current: '1.0.2', running: '1.0.1' }))).toBe('1.0.1');
  });

  it('uses the running core version when present', () => {
    expect(
      getDisplayedOtaVersion(status({ current: '2.2.13', running: '2.2.14', staged: '2.2.15' })),
    ).toBe('2.2.14');
  });

  it('falls back to current for older status payloads', () => {
    expect(getDisplayedOtaVersion(status({ current: '2.2.13' }))).toBe('2.2.13');
  });

  it('does not expose a staged version as the running OTA version', () => {
    expect(getDisplayedOtaVersion(status({ staged: '2.2.15' }))).toBeNull();
  });
});

describe('formatOtaVersionLabel', () => {
  it('does not add a v prefix to non-semver OTA names', () => {
    expect(formatOtaVersionLabel('r1')).toBe('OTA r1');
  });

  it('hides the core segment in the displayed version', () => {
    expect(formatOtaVersionLabel('2.2.19-canary.33-core.2')).toBe('OTA 2.2.19-canary.33-2');
  });
});
