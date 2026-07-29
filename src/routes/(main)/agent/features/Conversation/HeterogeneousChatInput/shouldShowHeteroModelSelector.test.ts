import { describe, expect, it } from 'vitest';

import { shouldShowHeteroModelSelector } from './shouldShowHeteroModelSelector';

describe('shouldShowHeteroModelSelector', () => {
  it('shows for sandbox-backed web runs', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'sandbox',
        isDesktopClient: false,
      }),
    ).toBe(true);
  });

  it('shows for desktop-local runs even when the desktop device id is persisted', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'desktop-device',
        executionTarget: 'local',
        isDesktopClient: true,
      }),
    ).toBe(true);
  });

  it('hides for explicit device runs because connected devices do not advertise selector args yet', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
        isDesktopClient: false,
      }),
    ).toBe(false);
  });

  it('hides for desktop-local selections opened from web because they dispatch to the bound device', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'desktop-device',
        executionTarget: 'local',
        isDesktopClient: false,
      }),
    ).toBe(false);
  });

  it('hides for auto device routing because selector args are not forwarded there', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'auto',
        isDesktopClient: false,
      }),
    ).toBe(false);
  });

  it('shows OpenCode models for desktop-local execution', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'local',
        isDesktopClient: true,
        providerType: 'opencode',
      }),
    ).toBe(true);
  });

  it('shows OpenCode models for an explicit bound device', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
        isDesktopClient: false,
        providerType: 'opencode',
      }),
    ).toBe(true);
  });

  it.each([
    ['device', undefined],
    ['auto', 'remote-device'],
    ['none', 'remote-device'],
    ['sandbox', 'remote-device'],
  ] as const)(
    'hides OpenCode models for unsupported target %s',
    (executionTarget, boundDeviceId) => {
      expect(
        shouldShowHeteroModelSelector({
          boundDeviceId,
          executionTarget,
          isDesktopClient: false,
          providerType: 'opencode',
        }),
      ).toBe(false);
    },
  );
});
