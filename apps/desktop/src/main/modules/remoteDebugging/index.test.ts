import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPOSE_STORES_ARG, readExposeStoresArg } from '~common/remoteDebugging';

import type * as RemoteDebugging from './index';

vi.mock('electron', () => ({
  app: { commandLine: { appendSwitch: vi.fn(), hasSwitch: vi.fn() } },
}));

describe('remoteDebugging', () => {
  let applyRemoteDebuggingSwitch: typeof RemoteDebugging.applyRemoteDebuggingSwitch;
  let getRemoteDebuggingLaunchState: typeof RemoteDebugging.getRemoteDebuggingLaunchState;
  let getRemoteDebuggingRendererArgs: typeof RemoteDebugging.getRemoteDebuggingRendererArgs;
  let REMOTE_DEBUGGING_PORT: number;

  // The module remembers whether the toggle opened CDP, so each case loads a fresh copy.
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(false);
    ({
      applyRemoteDebuggingSwitch,
      getRemoteDebuggingLaunchState,
      getRemoteDebuggingRendererArgs,
      REMOTE_DEBUGGING_PORT,
    } = await import('./index'));
  });

  it('opens the CDP port when the toggle is on', () => {
    applyRemoteDebuggingSwitch(true);

    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'remote-debugging-port',
      String(REMOTE_DEBUGGING_PORT),
    );
  });

  it('leaves the port closed when the toggle is off', () => {
    applyRemoteDebuggingSwitch(false);

    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('keeps a port given on the command line', () => {
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(true);

    applyRemoteDebuggingSwitch(true);

    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('tells the renderer to expose stores only while CDP is open', () => {
    expect(getRemoteDebuggingRendererArgs()).toEqual([]);

    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(true);

    expect(getRemoteDebuggingRendererArgs()).toEqual([EXPOSE_STORES_ARG]);
    expect(readExposeStoresArg(['--other', EXPOSE_STORES_ARG])).toBe(true);
    expect(readExposeStoresArg(['--other'])).toBe(false);
  });

  it('reports CDP opened by the toggle as active and switchable', () => {
    applyRemoteDebuggingSwitch(true);
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(true);

    expect(getRemoteDebuggingLaunchState()).toEqual({ active: true, openedByLaunchOption: false });
  });

  it('reports CDP opened by a launch option as locked on', () => {
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(true);
    applyRemoteDebuggingSwitch(false);

    expect(getRemoteDebuggingLaunchState()).toEqual({ active: true, openedByLaunchOption: true });
  });

  it('reports CDP closed when neither opened it', () => {
    expect(getRemoteDebuggingLaunchState()).toEqual({ active: false, openedByLaunchOption: false });
  });
});
