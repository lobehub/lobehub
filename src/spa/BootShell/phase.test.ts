import { describe, expect, it } from 'vitest';

import { resolveBootShellPhase } from './phase';

describe('resolveBootShellPhase', () => {
  it('stays hidden before the delay elapses so a warm boot never flashes a shell', () => {
    expect(resolveBootShellPhase({ appPainted: false, appReady: false, delayElapsed: false })).toBe(
      'hidden',
    );
  });

  it('shows the shell once the delay elapses and the app is still booting', () => {
    expect(resolveBootShellPhase({ appPainted: false, appReady: false, delayElapsed: true })).toBe(
      'shell',
    );
  });

  it('needs BOTH gates released before it is done', () => {
    expect(resolveBootShellPhase({ appPainted: true, appReady: false, delayElapsed: true })).toBe(
      'shell',
    );
    expect(resolveBootShellPhase({ appPainted: false, appReady: true, delayElapsed: true })).toBe(
      'shell',
    );
  });

  it('is done regardless of the delay when the app has painted', () => {
    expect(resolveBootShellPhase({ appPainted: true, appReady: true, delayElapsed: false })).toBe(
      'done',
    );
    expect(resolveBootShellPhase({ appPainted: true, appReady: true, delayElapsed: true })).toBe(
      'done',
    );
  });
});
