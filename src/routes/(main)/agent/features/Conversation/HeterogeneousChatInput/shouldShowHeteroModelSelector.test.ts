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

  it('shows for explicit device runs because dispatch forwards --model/--effort to the device', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
        isDesktopClient: false,
      }),
    ).toBe(true);
  });

  it('shows for desktop-local selections opened from web (device dispatch forwards selector args)', () => {
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'desktop-device',
        executionTarget: 'local',
        isDesktopClient: false,
      }),
    ).toBe(true);
  });

  it('shows for auto device routing because the auto-resolved device dispatch carries selector args', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'auto',
        isDesktopClient: false,
      }),
    ).toBe(true);
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

  it('shows Pi models for desktop-local execution and an explicit bound device', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'local',
        isDesktopClient: true,
        providerType: 'pi',
      }),
    ).toBe(true);
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
        isDesktopClient: false,
        providerType: 'pi',
      }),
    ).toBe(true);
  });

  it('hides Pi models without a concrete supported target', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'auto',
        isDesktopClient: false,
        providerType: 'pi',
      }),
    ).toBe(false);
  });

  it('shows Qoder models only when a concrete catalog target is available', () => {
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'local',
        isDesktopClient: true,
        providerType: 'qoder',
      }),
    ).toBe(true);
    expect(
      shouldShowHeteroModelSelector({
        boundDeviceId: 'remote-device',
        executionTarget: 'device',
        isDesktopClient: false,
        providerType: 'qoder',
      }),
    ).toBe(true);
    expect(
      shouldShowHeteroModelSelector({
        executionTarget: 'auto',
        isDesktopClient: false,
        providerType: 'qoder',
      }),
    ).toBe(false);
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
