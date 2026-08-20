import { describe, expect, it } from 'vitest';

import type { CommandMode } from './commandMode';
import { COMMAND_MODES, decideSandbox, mergeCommandMode, parseCommandMode } from './commandMode';

describe('parseCommandMode', () => {
  it('accepts every declared mode and nothing else', () => {
    for (const mode of COMMAND_MODES) expect(parseCommandMode(mode)).toBe(mode);

    for (const junk of ['', 'Sandbox', 'sandboxed', 'true', 0, null, undefined, {}]) {
      expect(parseCommandMode(junk)).toBeUndefined();
    }
  });
});

describe('mergeCommandMode', () => {
  it('lets a pushed mode tighten', () => {
    expect(mergeCommandMode('auto', 'sandbox')).toBe('sandbox');
    expect(mergeCommandMode('host', 'auto')).toBe('auto');
    expect(mergeCommandMode('host', 'sandbox')).toBe('sandbox');
  });

  /**
   * The rule this whole design rests on. If a push-down could loosen, an
   * operator who set `sandbox` on a machine would have it turned off by
   * whoever controls the server — and nothing local would show it happened.
   */
  it('never lets a pushed mode loosen', () => {
    expect(mergeCommandMode('sandbox', 'auto')).toBe('sandbox');
    expect(mergeCommandMode('sandbox', 'host')).toBe('sandbox');
    expect(mergeCommandMode('auto', 'host')).toBe('auto');
  });

  it('keeps the local mode when nothing is pushed', () => {
    for (const mode of COMMAND_MODES) expect(mergeCommandMode(mode)).toBe(mode);
  });

  it('is idempotent and order-independent for the same pair', () => {
    for (const a of COMMAND_MODES) {
      for (const b of COMMAND_MODES) {
        expect(mergeCommandMode(a, b)).toBe(mergeCommandMode(b, a));
        expect(mergeCommandMode(mergeCommandMode(a, b), b)).toBe(mergeCommandMode(a, b));
      }
    }
  });
});

describe('decideSandbox', () => {
  it('honours the run in auto mode', () => {
    expect(decideSandbox({ mode: 'auto', requested: true })).toMatchObject({ kind: 'sandbox' });
    expect(decideSandbox({ mode: 'auto', requested: false })).toEqual({ kind: 'host' });
    expect(decideSandbox({ mode: 'auto' })).toEqual({ kind: 'host' });
  });

  it('fences everything in sandbox mode, including runs that never asked', () => {
    expect(decideSandbox({ mode: 'sandbox' })).toMatchObject({ kind: 'sandbox' });
    expect(decideSandbox({ mode: 'sandbox', requested: false })).toMatchObject({ kind: 'sandbox' });
  });

  /**
   * The authority-inversion guard: no combination may turn a run that asked to
   * be fenced into one that silently is not. `host` refuses instead — a wrong
   * answer the caller can see beats a right-looking one it cannot.
   */
  it('never downgrades a requested fence to an unfenced run', () => {
    for (const mode of COMMAND_MODES) {
      const decision = decideSandbox({ mode: mode as CommandMode, requested: true });
      expect(decision.kind).not.toBe('host');
    }

    expect(decideSandbox({ mode: 'host', requested: true })).toMatchObject({ kind: 'refused' });
  });

  it('runs on the host in host mode when no fence was asked for', () => {
    expect(decideSandbox({ mode: 'host' })).toEqual({ kind: 'host' });
    expect(decideSandbox({ mode: 'host', requested: false })).toEqual({ kind: 'host' });
  });

  describe('network', () => {
    it('follows the run when the run asked for the fence', () => {
      expect(decideSandbox({ mode: 'auto', requested: true, requestedNetwork: true })).toEqual({
        allowNetwork: true,
        kind: 'sandbox',
      });

      // The device's own preference must not widen a fence the run scoped.
      expect(
        decideSandbox({
          deviceNetwork: true,
          mode: 'sandbox',
          requested: true,
          requestedNetwork: false,
        }),
      ).toEqual({ allowNetwork: false, kind: 'sandbox' });
    });

    it('follows the device when the device imposed the fence', () => {
      expect(decideSandbox({ deviceNetwork: true, mode: 'sandbox' })).toEqual({
        allowNetwork: true,
        kind: 'sandbox',
      });

      expect(decideSandbox({ mode: 'sandbox' })).toEqual({ allowNetwork: false, kind: 'sandbox' });
    });
  });
});
