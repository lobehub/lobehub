import { describe, expect, it } from 'vitest';

import { resolveHeteroProfilePanel } from './heteroProfilePanel';

describe('resolveHeteroProfilePanel', () => {
  it('describes the bound device for an agent connected from a remote device', () => {
    // An agent created from a remote device is stored as `device` + that
    // device id; the profile must probe it, not the desktop it is open on.
    expect(
      resolveHeteroProfilePanel({
        deviceId: 'device-us-1',
        providerType: 'claude-code',
        target: 'device',
      }),
    ).toEqual({ deviceId: 'device-us-1', kind: 'device' });
  });

  it('probes this desktop only for a local target', () => {
    expect(resolveHeteroProfilePanel({ providerType: 'codex', target: 'local' })).toEqual({
      kind: 'local',
    });
  });

  it('shows the cloud config for a Claude Code sandbox target', () => {
    expect(resolveHeteroProfilePanel({ providerType: 'claude-code', target: 'sandbox' })).toEqual({
      kind: 'cloud',
    });
  });

  it('shows the plain sandbox panel for providers without cloud config', () => {
    expect(resolveHeteroProfilePanel({ providerType: 'codex', target: 'sandbox' })).toEqual({
      kind: 'sandbox',
    });
  });

  it('waits for a pick when no device is bound or no target is chosen', () => {
    expect(resolveHeteroProfilePanel({ providerType: 'claude-code', target: 'device' })).toEqual({
      kind: 'pending',
    });
    expect(resolveHeteroProfilePanel({ providerType: 'opencode', target: 'none' })).toEqual({
      kind: 'pending',
    });
  });

  it('keeps bundled runtimes on their runtime panel', () => {
    expect(
      resolveHeteroProfilePanel({
        deviceId: 'device-us-1',
        providerType: 'deepseek-harness',
        target: 'device',
      }),
    ).toEqual({ kind: 'runtime' });
  });
});
