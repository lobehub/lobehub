import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EXPOSE_STORES_ARG, readExposeStoresArg } from '~common/remoteDebugging';

import {
  applyRemoteDebuggingSwitch,
  getRemoteDebuggingRendererArgs,
  REMOTE_DEBUGGING_PORT,
} from './index';

vi.mock('electron', () => ({
  app: { commandLine: { appendSwitch: vi.fn(), hasSwitch: vi.fn() } },
}));

describe('remoteDebugging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(app.commandLine.hasSwitch).mockReturnValue(false);
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
});
