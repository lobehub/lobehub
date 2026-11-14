import { app } from 'electron';

import { createLogger } from '@/utils/logger';
import { EXPOSE_STORES_ARG } from '~common/remoteDebugging';

const logger = createLogger('modules:remoteDebugging');

/** Port the persisted Settings → About → Remote Debugging toggle opens CDP on. */
export const REMOTE_DEBUGGING_PORT = 9222;

const REMOTE_DEBUGGING_SWITCH = 'remote-debugging-port';

/** Whether this launch opened CDP because of the persisted toggle, not a launch option. */
let openedByToggle = false;

/**
 * Open the Chromium DevTools protocol port when the user turned the toggle on.
 * Must run before `app.whenReady()`: Chromium reads the switch only at startup,
 * so a change applies on the next launch.
 *
 * A port already given on the command line (`--remote-debugging-port`, or the dev
 * launcher's `LOBE_DESKTOP_CDP_PORT`) wins. Chromium binds the port to 127.0.0.1.
 */
export const applyRemoteDebuggingSwitch = (enabled: boolean): void => {
  if (!enabled || app.commandLine.hasSwitch(REMOTE_DEBUGGING_SWITCH)) return;

  app.commandLine.appendSwitch(REMOTE_DEBUGGING_SWITCH, String(REMOTE_DEBUGGING_PORT));
  openedByToggle = true;
  logger.warn(`Remote debugging is enabled on 127.0.0.1:${REMOTE_DEBUGGING_PORT}`);
};

/**
 * Renderer arguments for app windows. While CDP is open, by the toggle or a
 * command-line switch, the renderer also exposes its store snapshots: anything that
 * can attach to CDP can already evaluate code in the page, so this adds no access.
 */
export const getRemoteDebuggingRendererArgs = (): string[] =>
  app.commandLine.hasSwitch(REMOTE_DEBUGGING_SWITCH) ? [EXPOSE_STORES_ARG] : [];

export interface RemoteDebuggingLaunchState {
  /** CDP is open in this launch, by the toggle or a launch option. */
  active: boolean;
  /** A launch option opened CDP, so the toggle cannot close it. */
  openedByLaunchOption: boolean;
}

export const getRemoteDebuggingLaunchState = (): RemoteDebuggingLaunchState => {
  const active = app.commandLine.hasSwitch(REMOTE_DEBUGGING_SWITCH);
  return { active, openedByLaunchOption: active && !openedByToggle };
};
