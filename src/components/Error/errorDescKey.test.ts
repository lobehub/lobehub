import { describe, expect, it } from 'vitest';

import { DesktopIpcUnavailableError } from '@/utils/electron/ipc';

import { getErrorDescKey } from './errorDescKey';

describe('getErrorDescKey', () => {
  it('keeps the generic description for an ordinary error', () => {
    expect(getErrorDescKey(new Error('boom'))).toBe('error.desc');
    expect(getErrorDescKey(undefined)).toBe('error.desc');
  });

  // A desktop window whose preload never exposed the bridge cannot mount the app;
  // its error page used to say only "Give it a try later", hiding the recovery.
  it('tells a desktop window without the bridge how to reconnect', () => {
    expect(getErrorDescKey(new DesktopIpcUnavailableError('preload-missing'))).toBe(
      'error.desktopIpc.preloadMissing',
    );
  });

  it('tells a web browser to open the desktop app', () => {
    expect(getErrorDescKey(new DesktopIpcUnavailableError('not-desktop'))).toBe(
      'error.desktopIpc.notDesktop',
    );
  });

  it('recognises the error from a second copy of the module by name', () => {
    const copy = Object.assign(new Error('bridge missing'), {
      name: 'DesktopIpcUnavailableError',
      reason: 'preload-missing' as const,
    });
    expect(getErrorDescKey(copy)).toBe('error.desktopIpc.preloadMissing');
  });
});
