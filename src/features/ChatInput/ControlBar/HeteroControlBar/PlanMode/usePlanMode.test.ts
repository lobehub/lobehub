import { describe, expect, it } from 'vitest';

import { resolvePlanModeAvailability } from './usePlanMode';

describe('resolvePlanModeAvailability', () => {
  const base = { appServerLab: true, executionTarget: 'local' };

  it('is available for a local run with the Codex app-server lab on', () => {
    expect(resolvePlanModeAvailability(base)).toBeUndefined();
  });

  it('needs the Codex app-server lab', () => {
    expect(resolvePlanModeAvailability({ ...base, appServerLab: false })).toBe('appServerLab');
  });

  it('is unavailable where Codex runs through exec: API auth, the cloud sandbox', () => {
    expect(resolvePlanModeAvailability({ ...base, authMode: 'api' })).toBe('unsupported');
    expect(resolvePlanModeAvailability({ ...base, executionTarget: 'sandbox' })).toBe(
      'unsupported',
    );
  });

  it('is unavailable for provider arguments only codex exec honors', () => {
    expect(resolvePlanModeAvailability({ ...base, providerArgs: ['--profile', 'work'] })).toBe(
      'unsupported',
    );
    expect(
      resolvePlanModeAvailability({ ...base, providerArgs: ['-m', 'gpt-6.1-sol'] }),
    ).toBeUndefined();
  });

  it('needs a device whose lh takes the switch', () => {
    const device = { ...base, executionTarget: 'device' };
    expect(
      resolvePlanModeAvailability({
        ...device,
        deviceRuntimes: ['codex-app-server-v1', 'codex-collaboration-mode-v1'],
      }),
    ).toBeUndefined();
    // An older lh advertises the app-server but not the switch.
    expect(
      resolvePlanModeAvailability({ ...device, deviceRuntimes: ['codex-app-server-v1'] }),
    ).toBe('unsupported');
    expect(resolvePlanModeAvailability(device)).toBe('unsupported');
  });
});
